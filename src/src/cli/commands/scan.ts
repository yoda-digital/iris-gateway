import { Command, Option } from "clipanion";
import { resolve } from "node:path";
import { SecurityScanner } from "../../security/scanner.js";

export class ScanCommand extends Command {
  static override paths = [["scan"]];

  static override usage = Command.Usage({
    description: "Scan a directory for security issues",
    examples: [
      ["Scan current directory", "iris scan"],
      ["Scan a plugin directory", "iris scan ./plugins/my-plugin"],
    ],
  });

  targetDir = Option.String({ required: false });

  async execute(): Promise<number> {
    const targetPath = resolve(this.targetDir ?? ".");
    const scanner = new SecurityScanner();

    this.context.stdout.write(`Scanning ${targetPath}...\n`);
    const result = await scanner.scanDirectory(targetPath);

    this.context.stdout.write(`\nScanned ${result.scannedFiles} files\n`);

    if (result.findings.length === 0) {
      this.context.stdout.write("No issues found.\n");
      return 0;
    }

    this.context.stdout.write(`\nFindings: ${result.critical} critical, ${result.warn} warnings, ${result.info} info\n\n`);

    for (const finding of result.findings) {
      const severity = finding.severity === "critical"
        ? "\x1b[31mCRITICAL\x1b[0m"
        : finding.severity === "warn"
          ? "\x1b[33mWARN\x1b[0m"
          : "\x1b[34mINFO\x1b[0m";

      this.context.stdout.write(
        `  ${severity}  ${finding.ruleId}\n` +
        `    ${finding.file}:${finding.line}\n` +
        `    ${finding.message}\n` +
        `    > ${finding.evidence}\n\n`,
      );
    }

    return result.safe ? 0 : 1;
  }
}
