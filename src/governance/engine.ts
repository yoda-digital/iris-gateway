import type {
  GovernanceConfig,
  GovernanceRule,
  EvaluationResult,
} from "./types.js";

export class GovernanceEngine {
  constructor(private readonly config: GovernanceConfig) {}

  evaluate(
    toolName: string,
    args: Record<string, unknown>,
  ): EvaluationResult {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    for (const rule of this.config.rules) {
      if (rule.tool !== toolName && rule.tool !== "*") continue;
      if (rule.type === "audit") continue;

      const result = this.evaluateRule(rule, args);
      if (!result.allowed) return result;
    }

    return { allowed: true };
  }

  getDirectivesBlock(): string {
    if (this.config.directives.length === 0) return "";
    return `## Governance Directives\n${this.config.directives.join("\n")}`;
  }

  getRules(): GovernanceRule[] {
    return this.config.rules;
  }

  private evaluateRule(
    rule: GovernanceRule,
    args: Record<string, unknown>,
  ): EvaluationResult {
    switch (rule.type) {
      case "constraint":
        return this.evaluateConstraint(rule, args);
      case "rate_limit":
        return { allowed: true };
      case "custom":
        return { allowed: true };
      default:
        return { allowed: true };
    }
  }

  private evaluateConstraint(
    rule: GovernanceRule,
    args: Record<string, unknown>,
  ): EvaluationResult {
    const field = rule.params["field"] as string | undefined;
    const maxLength = rule.params["maxLength"] as number | undefined;

    if (field && maxLength !== undefined) {
      const value = args[field];
      if (typeof value === "string" && value.length > maxLength) {
        return {
          allowed: false,
          ruleId: rule.id,
          reason: `${field} exceeds max length of ${maxLength} (got ${value.length})`,
        };
      }
    }

    return { allowed: true };
  }
}
