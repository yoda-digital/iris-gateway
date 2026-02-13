export interface GovernanceRule {
  readonly id: string;
  readonly description: string;
  readonly tool: string; // tool name or "*" for all
  readonly type: "rate_limit" | "constraint" | "custom" | "audit";
  readonly params: Record<string, unknown>;
}

export interface GovernanceConfig {
  readonly enabled: boolean;
  readonly rules: GovernanceRule[];
  readonly directives: string[];
}

export interface EvaluationResult {
  readonly allowed: boolean;
  readonly ruleId?: string;
  readonly reason?: string;
}
