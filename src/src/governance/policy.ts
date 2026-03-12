import type { PolicyConfig } from "../config/types.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PolicyViolation {
  readonly level: "error" | "warning";
  readonly code: string;
  readonly message: string;
}

export interface AgentValidationRequest {
  readonly name: string;
  readonly mode?: string;
  readonly tools?: string[];
  readonly skills?: string[];
  readonly steps?: number;
  readonly description?: string;
  readonly permission?: Record<string, unknown>;
}

export interface SkillValidationRequest {
  readonly name: string;
  readonly triggers?: string;
}

export interface AuditResult {
  readonly name: string;
  readonly type: "agent" | "skill";
  readonly violations: PolicyViolation[];
  readonly compliant: boolean;
}

/**
 * PolicyEngine enforces the master policy — the structural ceiling
 * for what agents, skills, and tools can exist and do.
 *
 * Three enforcement points:
 * 1. Creation-time: validateAgent/validateSkill before writing files
 * 2. Runtime: isToolAllowed before every tool call
 * 3. Audit: auditAll scans existing agents/skills for violations
 *
 * Key invariant: agents can only NARROW within the policy, never widen.
 */
export class PolicyEngine {
  constructor(private readonly config: PolicyConfig) {}

  /** Whether the policy system is enabled. When disabled, everything is permitted. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Get the full policy config (for status endpoints). */
  getConfig(): PolicyConfig {
    return this.config;
  }

  // ── Tool enforcement (runtime) ──

  /**
   * Check if a tool call is allowed by master policy.
   * Called in tool.execute.before BEFORE governance checks.
   */
  isToolAllowed(toolName: string): { allowed: boolean; reason?: string } {
    if (!this.config.enabled) return { allowed: true };

    // Denied list always wins — belt and suspenders
    if (this.config.tools.denied.length > 0 && this.config.tools.denied.includes(toolName)) {
      return { allowed: false, reason: `Tool '${toolName}' is explicitly denied by master policy` };
    }

    // If allowlist is non-empty and enforcement is on, tool must be in it
    if (
      this.config.enforcement.blockUnknownTools &&
      this.config.tools.allowed.length > 0 &&
      !this.config.tools.allowed.includes(toolName)
    ) {
      return { allowed: false, reason: `Tool '${toolName}' is not in master policy allowlist` };
    }

    return { allowed: true };
  }

  // ── Permission enforcement (runtime) ──

  /**
   * Check if a permission should be denied by master policy.
   * Called in permission.ask hook.
   */
  isPermissionDenied(permission: string): boolean {
    if (!this.config.enabled) return false;

    const perms = this.config.permissions;
    if (permission === "bash" && perms.bash === "deny") return true;
    if (permission === "edit" && perms.edit === "deny") return true;
    if (permission === "read" && perms.read === "deny") return true;
    return false;
  }

  // ── Agent creation validation ──

  /**
   * Validate an agent creation request against master policy.
   * Returns violations (errors block creation, warnings are advisory).
   */
  validateAgentCreation(req: AgentValidationRequest): PolicyViolation[] {
    if (!this.config.enabled) return [];

    const violations: PolicyViolation[] = [];
    const agentPolicy = this.config.agents;

    // Mode check
    const mode = req.mode ?? "subagent";
    if (!agentPolicy.allowedModes.includes(mode)) {
      violations.push({
        level: "error",
        code: "AGENT_MODE_DENIED",
        message: `Mode '${mode}' is not allowed. Allowed: ${agentPolicy.allowedModes.join(", ")}`,
      });
    }

    // Primary creation check
    if (mode === "primary" && !agentPolicy.allowPrimaryCreation) {
      violations.push({
        level: "error",
        code: "AGENT_PRIMARY_DENIED",
        message: "Creating primary agents is not allowed by policy",
      });
    }

    // Description required
    if (agentPolicy.requireDescription && !req.description?.trim()) {
      violations.push({
        level: "error",
        code: "AGENT_DESCRIPTION_REQUIRED",
        message: "Agent description is required by policy",
      });
    }

    // Steps limit
    if (agentPolicy.maxSteps > 0 && req.steps && req.steps > agentPolicy.maxSteps) {
      violations.push({
        level: "error",
        code: "AGENT_STEPS_EXCEEDED",
        message: `Steps ${req.steps} exceeds policy limit of ${agentPolicy.maxSteps}`,
      });
    }

    // Tool validation: each declared tool must be in master allowlist
    if (req.tools?.length && this.config.tools.allowed.length > 0) {
      for (const tool of req.tools) {
        if (!this.config.tools.allowed.includes(tool)) {
          violations.push({
            level: "error",
            code: "AGENT_TOOL_NOT_ALLOWED",
            message: `Tool '${tool}' is not in master policy allowlist`,
          });
        }
      }
    }

    // Denied tools check
    if (req.tools?.length && this.config.tools.denied.length > 0) {
      for (const tool of req.tools) {
        if (this.config.tools.denied.includes(tool)) {
          violations.push({
            level: "error",
            code: "AGENT_TOOL_DENIED",
            message: `Tool '${tool}' is explicitly denied by master policy`,
          });
        }
      }
    }

    // Skill validation: restricted skills can't be assigned
    if (req.skills?.length && this.config.skills.restricted.length > 0) {
      for (const skill of req.skills) {
        if (this.config.skills.restricted.includes(skill)) {
          violations.push({
            level: "error",
            code: "AGENT_SKILL_RESTRICTED",
            message: `Skill '${skill}' is restricted by master policy`,
          });
        }
      }
    }

    // Permission weakening check: agent permission can't grant what master denies
    if (req.permission) {
      this.checkPermissionWeakening(req.permission, violations);
    }

    return violations;
  }

  // ── Skill creation validation ──

  validateSkillCreation(req: SkillValidationRequest): PolicyViolation[] {
    if (!this.config.enabled) return [];

    const violations: PolicyViolation[] = [];

    // Restricted skill names
    if (this.config.skills.restricted.includes(req.name)) {
      violations.push({
        level: "error",
        code: "SKILL_RESTRICTED",
        message: `Skill name '${req.name}' is restricted by master policy`,
      });
    }

    // Trigger requirement
    if (this.config.skills.requireTriggers && !req.triggers?.trim()) {
      violations.push({
        level: "warning",
        code: "SKILL_NO_TRIGGERS",
        message: "Policy recommends triggers for proactive skill suggestion",
      });
    }

    return violations;
  }

  // ── Audit existing agents and skills ──

  auditAll(): AuditResult[] {
    const results: AuditResult[] = [];
    const agentsDir = resolve(process.cwd(), ".opencode", "agents");
    const skillsDir = resolve(process.cwd(), ".opencode", "skills");

    // Audit agents
    if (existsSync(agentsDir)) {
      for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const name = entry.name.replace(/\.md$/, "");
        const raw = readFileSync(join(agentsDir, entry.name), "utf-8");
        const violations = this.auditAgent(name, raw);
        results.push({ name, type: "agent", violations, compliant: !violations.some((v) => v.level === "error") });
      }
    }

    // Audit skills
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const skillFile = join(skillsDir, entry.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        const raw = readFileSync(skillFile, "utf-8");
        const violations = this.auditSkill(entry.name, raw);
        results.push({ name: entry.name, type: "skill", violations, compliant: !violations.some((v) => v.level === "error") });
      }
    }

    return results;
  }

  // ── Private helpers ──

  private auditAgent(name: string, raw: string): PolicyViolation[] {
    if (!this.config.enabled) return [];

    const violations: PolicyViolation[] = [];

    // Extract mode
    const modeMatch = raw.match(/mode:\s*(\w+)/);
    const mode = modeMatch?.[1] ?? "unknown";
    if (!this.config.agents.allowedModes.includes(mode) && mode !== "primary") {
      violations.push({
        level: "error",
        code: "AGENT_MODE_DENIED",
        message: `Agent '${name}' has mode '${mode}' not in policy allowlist`,
      });
    }

    // Extract tools
    const toolMatches = raw.matchAll(/^\s+(\w+):\s*true/gm);
    for (const match of toolMatches) {
      const tool = match[1];
      if (this.config.tools.denied.includes(tool)) {
        violations.push({
          level: "error",
          code: "AGENT_TOOL_DENIED",
          message: `Agent '${name}' uses denied tool '${tool}'`,
        });
      }
      if (this.config.tools.allowed.length > 0 && !this.config.tools.allowed.includes(tool) && tool !== "skill") {
        violations.push({
          level: "warning",
          code: "AGENT_TOOL_NOT_ALLOWED",
          message: `Agent '${name}' uses tool '${tool}' not in master allowlist`,
        });
      }
    }

    // Check description
    if (this.config.agents.requireDescription && !/description:\s*.+/.test(raw)) {
      violations.push({
        level: "warning",
        code: "AGENT_NO_DESCRIPTION",
        message: `Agent '${name}' has no description (required by policy)`,
      });
    }

    // Check skills against restricted
    const skillMatches = raw.matchAll(/^\s+-\s+(\S+)/gm);
    for (const match of skillMatches) {
      if (this.config.skills.restricted.includes(match[1])) {
        violations.push({
          level: "error",
          code: "AGENT_SKILL_RESTRICTED",
          message: `Agent '${name}' uses restricted skill '${match[1]}'`,
        });
      }
    }

    return violations;
  }

  private auditSkill(name: string, raw: string): PolicyViolation[] {
    if (!this.config.enabled) return [];

    const violations: PolicyViolation[] = [];

    if (this.config.skills.restricted.includes(name)) {
      violations.push({
        level: "error",
        code: "SKILL_RESTRICTED",
        message: `Skill '${name}' is restricted by master policy`,
      });
    }

    if (this.config.skills.requireTriggers && !/triggers:/.test(raw)) {
      violations.push({
        level: "warning",
        code: "SKILL_NO_TRIGGERS",
        message: `Skill '${name}' has no trigger keywords`,
      });
    }

    return violations;
  }

  private checkPermissionWeakening(
    agentPerm: Record<string, unknown>,
    violations: PolicyViolation[],
  ): void {
    const masterPerms = this.config.permissions;
    const permMap: Record<string, "allow" | "deny"> = {
      bash: masterPerms.bash,
      edit: masterPerms.edit,
      read: masterPerms.read,
    };

    // Flatten: check allow.bash, allow.edit, etc.
    const allow = agentPerm["allow"] as Record<string, unknown> | undefined;
    if (allow && typeof allow === "object") {
      for (const [key, val] of Object.entries(allow)) {
        if (permMap[key] === "deny" && val !== "deny") {
          violations.push({
            level: "error",
            code: "AGENT_PERM_WEAKENING",
            message: `Agent permission allows '${key}' but master policy denies it`,
          });
        }
      }
    }
  }
}
