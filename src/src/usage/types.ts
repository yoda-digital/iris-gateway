export interface UsageRecord {
  readonly sessionId: string | null;
  readonly senderId: string | null;
  readonly channelId: string | null;
  readonly modelId: string | null;
  readonly providerId: string | null;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly tokensReasoning: number;
  readonly tokensCacheRead: number;
  readonly tokensCacheWrite: number;
  readonly costUsd: number;
  readonly durationMs: number | null;
}

export interface UsageSummary {
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly messageCount: number;
  readonly period: string;
  readonly breakdown: UsageBreakdown[];
}

export interface UsageBreakdown {
  readonly date: string;
  readonly tokens: number;
  readonly cost: number;
  readonly messages: number;
}
