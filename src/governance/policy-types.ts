/**
 * policy-types.ts — Shared interfaces for the policy engine.
 * Extracted from policy.ts (VISION.md §1 — 500-line hard limit pre-emption).
 *
 * @decomposition-plan
 * policy.ts was split at 367 lines:
 *   - policy-types.ts  → shared interfaces (this file)
 *   - policy-audit.ts  → audit scanning (auditAll/auditAgent/auditSkill)
 *   - policy.ts        → runtime enforcement + creation validation (PolicyEngine)
 */

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
