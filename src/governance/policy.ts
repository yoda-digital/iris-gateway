/**
 * policy.ts — Runtime policy enforcement + creation validation.
 *
 * @decomposition-plan (issue #235 — VISION.md §1 pre-emption at 367 lines)
 * Extracted to sibling modules to stay well below the 500-line limit:
 *   - policy-types.ts  → shared interfaces (PolicyViolation, AuditResult, etc.)
 *   - policy-audit.ts  → auditAll() — scanning existing agents/skills
 *   - policy.ts        → PolicyEngine runtime enforcement (this file, ~180 lines)
 *
 * PolicyEngine: three enforcement points:
 *   1. Creation-time: validateAgent/validateSkill before writing files
 *   2. Runtime: isToolAllowed before every tool call
 *   3. Audit: delegates to policy-audit.ts
 *
 * Key invariant: agents can only NARROW within policy, never widen.
 */
import type { PolicyConfig } from "../config/types.js";
import { auditAll } from "./policy-audit.js";
import type { AuditResult, AgentValidationRequest, PolicyViolation, SkillValidationRequest } from "./policy-types.js";

export type { AuditResult, AgentValidationRequest, PolicyViolation, SkillValidationRequest };

export class PolicyEngine {
  constructor(private readonly config: PolicyConfig) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): PolicyConfig {
    return this.config;
  }

  // ── Tool enforcement (runtime) ──

  isToolAllowed(toolName: string): { allowed: boolean; reason?: string } {
    if (!this.config.enabled) return { allowed: true };

    if (this.config.tools.denied.length > 0 && this.config.tools.denied.includes(toolName)) {
      return { allowed: false, reason: `Tool '${toolName}' is explicitly denied by master policy` };
    }

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

  isPermissionDenied(permission: string): boolean {
    if (!this.config.enabled) return false;

    const perms = this.config.permissions;
    if (permission === "bash" && perms.bash === "deny") return true;
    if (permission === "edit" && perms.edit === "deny") return true;
    if (permission === "read" && perms.read === "deny") return true;
    return false;
  }

  // ── Agent creation validation ──

  validateAgentCreation(req: AgentValidationRequest): PolicyViolation[] {
    if (!this.config.enabled) return [];

    const violations: PolicyViolation[] = [];
    const agentPolicy = this.config.agents;

    const mode = req.mode ?? "subagent";
    if (!agentPolicy.allowedModes.includes(mode)) {
      violations.push({ level: "error", code: "AGENT_MODE_DENIED", message: `Mode '${mode}' is not allowed. Allowed: ${agentPolicy.allowedModes.join(", ")}` });
    }

    if (mode === "primary" && !agentPolicy.allowPrimaryCreation) {
      violations.push({ level: "error", code: "AGENT_PRIMARY_DENIED", message: "Creating primary agents is not allowed by policy" });
    }

    if (agentPolicy.requireDescription && !req.description?.trim()) {
      violations.push({ level: "error", code: "AGENT_DESCRIPTION_REQUIRED", message: "Agent description is required by policy" });
    }

    if (agentPolicy.maxSteps > 0 && req.steps && req.steps > agentPolicy.maxSteps) {
      violations.push({ level: "error", code: "AGENT_STEPS_EXCEEDED", message: `Steps ${req.steps} exceeds policy limit of ${agentPolicy.maxSteps}` });
    }

    if (req.tools?.length && this.config.tools.allowed.length > 0) {
      for (const tool of req.tools) {
        if (!this.config.tools.allowed.includes(tool)) {
          violations.push({ level: "error", code: "AGENT_TOOL_NOT_ALLOWED", message: `Tool '${tool}' is not in master policy allowlist` });
        }
      }
    }

    if (req.tools?.length && this.config.tools.denied.length > 0) {
      for (const tool of req.tools) {
        if (this.config.tools.denied.includes(tool)) {
          violations.push({ level: "error", code: "AGENT_TOOL_DENIED", message: `Tool '${tool}' is explicitly denied by master policy` });
        }
      }
    }

    if (req.skills?.length && this.config.skills.restricted.length > 0) {
      for (const skill of req.skills) {
        if (this.config.skills.restricted.includes(skill)) {
          violations.push({ level: "error", code: "AGENT_SKILL_RESTRICTED", message: `Skill '${skill}' is restricted by master policy` });
        }
      }
    }

    if (req.permission) {
      this.checkPermissionWeakening(req.permission, violations);
    }

    return violations;
  }

  // ── Skill creation validation ──

  validateSkillCreation(req: SkillValidationRequest): PolicyViolation[] {
    if (!this.config.enabled) return [];

    const violations: PolicyViolation[] = [];

    if (this.config.skills.restricted.includes(req.name)) {
      violations.push({ level: "error", code: "SKILL_RESTRICTED", message: `Skill name '${req.name}' is restricted by master policy` });
    }

    if (this.config.skills.requireTriggers && !req.triggers?.trim()) {
      violations.push({ level: "warning", code: "SKILL_NO_TRIGGERS", message: "Policy recommends triggers for proactive skill suggestion" });
    }

    return violations;
  }

  // ── Audit (delegates to policy-audit.ts) ──

  auditAll(): AuditResult[] {
    return auditAll(this.config);
  }

  // ── Private helpers ──

  private checkPermissionWeakening(agentPerm: Record<string, unknown>, violations: PolicyViolation[]): void {
    const masterPerms = this.config.permissions;
    const permMap: Record<string, "allow" | "deny"> = {
      bash: masterPerms.bash,
      edit: masterPerms.edit,
      read: masterPerms.read,
    };

    const allow = agentPerm["allow"] as Record<string, unknown> | undefined;
    if (allow && typeof allow === "object") {
      for (const [key, val] of Object.entries(allow)) {
        if (permMap[key] === "deny" && val !== "deny") {
          violations.push({ level: "error", code: "AGENT_PERM_WEAKENING", message: `Agent permission allows '${key}' but master policy denies it` });
        }
      }
    }
  }
}
