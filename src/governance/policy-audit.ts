/**
 * policy-audit.ts — Audit scanning logic for the policy engine.
 * Extracted from policy.ts (VISION.md §1 — 500-line hard limit pre-emption).
 *
 * Provides `auditAll()` which scans existing agents/skills for policy violations.
 * Intentionally decoupled from runtime enforcement (policy.ts).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PolicyConfig } from "../config/types.js";
import type { AuditResult, PolicyViolation } from "./policy-types.js";

export function auditAll(config: PolicyConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const agentsDir = resolve(process.cwd(), ".opencode", "agents");
  const skillsDir = resolve(process.cwd(), ".opencode", "skills");

  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const name = entry.name.replace(/\.md$/, "");
      const raw = readFileSync(join(agentsDir, entry.name), "utf-8");
      const violations = auditAgent(config, name, raw);
      results.push({ name, type: "agent", violations, compliant: !violations.some((v) => v.level === "error") });
    }
  }

  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillFile = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const raw = readFileSync(skillFile, "utf-8");
      const violations = auditSkill(config, entry.name, raw);
      results.push({ name: entry.name, type: "skill", violations, compliant: !violations.some((v) => v.level === "error") });
    }
  }

  return results;
}

function auditAgent(config: PolicyConfig, name: string, raw: string): PolicyViolation[] {
  if (!config.enabled) return [];

  const violations: PolicyViolation[] = [];

  const modeMatch = raw.match(/mode:\s*(\w+)/);
  const mode = modeMatch?.[1] ?? "unknown";
  if (!config.agents.allowedModes.includes(mode) && mode !== "primary") {
    violations.push({ level: "error", code: "AGENT_MODE_DENIED", message: `Agent '${name}' has mode '${mode}' not in policy allowlist` });
  }

  const toolMatches = raw.matchAll(/^\s+(\w+):\s*true/gm);
  for (const match of toolMatches) {
    const tool = match[1];
    if (config.tools.denied.includes(tool)) {
      violations.push({ level: "error", code: "AGENT_TOOL_DENIED", message: `Agent '${name}' uses denied tool '${tool}'` });
    }
    if (config.tools.allowed.length > 0 && !config.tools.allowed.includes(tool) && tool !== "skill") {
      violations.push({ level: "warning", code: "AGENT_TOOL_NOT_ALLOWED", message: `Agent '${name}' uses tool '${tool}' not in master allowlist` });
    }
  }

  if (config.agents.requireDescription && !/description:\s*.+/.test(raw)) {
    violations.push({ level: "warning", code: "AGENT_NO_DESCRIPTION", message: `Agent '${name}' has no description (required by policy)` });
  }

  const skillMatches = raw.matchAll(/^\s+-\s+(\S+)/gm);
  for (const match of skillMatches) {
    if (config.skills.restricted.includes(match[1])) {
      violations.push({ level: "error", code: "AGENT_SKILL_RESTRICTED", message: `Agent '${name}' uses restricted skill '${match[1]}'` });
    }
  }

  return violations;
}

function auditSkill(config: PolicyConfig, name: string, raw: string): PolicyViolation[] {
  if (!config.enabled) return [];

  const violations: PolicyViolation[] = [];

  if (config.skills.restricted.includes(name)) {
    violations.push({ level: "error", code: "SKILL_RESTRICTED", message: `Skill '${name}' is restricted by master policy` });
  }

  if (config.skills.requireTriggers && !/triggers:/.test(raw)) {
    violations.push({ level: "warning", code: "SKILL_NO_TRIGGERS", message: `Skill '${name}' has no trigger keywords` });
  }

  return violations;
}
