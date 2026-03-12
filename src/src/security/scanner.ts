import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { SCAN_RULES } from "./scan-rules.js";
import type { ScanFinding, ScanResult } from "./scan-types.js";

const SCANNABLE_EXTENSIONS = new Set([".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"]);
const MAX_FILE_SIZE = 1_048_576; // 1MB
const MAX_FILES = 500;

export class SecurityScanner {
  scanSource(source: string, filePath: string): ScanFinding[] {
    const findings: ScanFinding[] = [];
    const lines = source.split("\n");
    const matchedRules = new Set<string>();

    // Line rules
    for (const rule of SCAN_RULES) {
      if (rule.type !== "line" || matchedRules.has(rule.id)) continue;
      if (rule.context && rule.contextType === "import" && !rule.context.test(source)) continue;
      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: filePath,
            line: i + 1,
            message: rule.description,
            evidence: lines[i].trim().slice(0, 200),
          });
          matchedRules.add(rule.id);
          break;
        }
      }
    }

    // Source rules
    for (const rule of SCAN_RULES) {
      if (rule.type !== "source" || matchedRules.has(rule.id)) continue;
      if (!rule.pattern.test(source)) continue;
      if (rule.context && !rule.context.test(source)) continue;
      // Find first matching line for evidence
      let evidenceLine = 1;
      let evidence = "";
      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          evidenceLine = i + 1;
          evidence = lines[i].trim().slice(0, 200);
          break;
        }
      }
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        file: filePath,
        line: evidenceLine,
        message: rule.description,
        evidence,
      });
      matchedRules.add(rule.id);
    }

    return findings;
  }

  buildResult(findings: ScanFinding[], scannedFiles: number): ScanResult {
    const critical = findings.filter((f) => f.severity === "critical").length;
    const warn = findings.filter((f) => f.severity === "warn").length;
    const info = findings.filter((f) => f.severity === "info").length;
    return { safe: critical === 0, scannedFiles, findings, critical, warn, info };
  }

  async scanDirectory(dir: string): Promise<ScanResult> {
    const files = await this.discoverFiles(dir);
    const allFindings: ScanFinding[] = [];
    for (const file of files) {
      try {
        const source = await readFile(file, "utf-8");
        allFindings.push(...this.scanSource(source, file));
      } catch {
        // Skip unreadable files
      }
    }
    return this.buildResult(allFindings, files.length);
  }

  private async discoverFiles(dir: string, collected: string[] = []): Promise<string[]> {
    if (collected.length >= MAX_FILES) return collected;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (collected.length >= MAX_FILES) break;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.discoverFiles(full, collected);
      } else if (SCANNABLE_EXTENSIONS.has(extname(entry.name))) {
        const s = await stat(full);
        if (s.size <= MAX_FILE_SIZE) collected.push(full);
      }
    }
    return collected;
  }
}
