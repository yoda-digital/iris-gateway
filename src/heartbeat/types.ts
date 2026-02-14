export type HealthStatus = "healthy" | "degraded" | "down" | "recovering";

export interface HealthResult {
  readonly component: string;
  readonly status: HealthStatus;
  readonly latencyMs: number;
  readonly details?: string;
}

export interface HealthChecker {
  readonly name: string;
  check(): Promise<HealthResult>;
  heal?(): Promise<boolean>;
}

export interface HeartbeatLogEntry {
  readonly id: number;
  readonly component: string;
  readonly status: string;
  readonly latencyMs: number;
  readonly details: string | null;
  readonly checkedAt: number;
}

export interface HeartbeatActionEntry {
  readonly id: number;
  readonly component: string;
  readonly action: string;
  readonly success: boolean;
  readonly error: string | null;
  readonly executedAt: number;
}

export interface ActiveHoursConfig {
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
}

export interface VisibilityConfig {
  readonly showOk: boolean;
  readonly showAlerts: boolean;
  readonly useIndicator: boolean;
}

export interface EmptyCheckConfig {
  readonly enabled: boolean;
  readonly maxBackoffMs: number;
}

export interface HeartbeatConfig {
  readonly enabled: boolean;
  readonly intervals: {
    readonly healthy: number;
    readonly degraded: number;
    readonly critical: number;
  };
  readonly selfHeal: {
    readonly enabled: boolean;
    readonly maxAttempts: number;
    readonly backoffTicks: number;
  };
  readonly activity: {
    readonly enabled: boolean;
    readonly dormancyThresholdMs: number;
  };
  readonly logRetentionDays: number;
  // V2 features
  readonly activeHours?: ActiveHoursConfig;
  readonly visibility?: VisibilityConfig;
  readonly channelVisibility?: Record<string, Partial<VisibilityConfig>>;
  readonly dedupWindowMs?: number;
  readonly emptyCheck?: EmptyCheckConfig;
  readonly coalesceMs?: number;
  readonly retryMs?: number;
  readonly agents?: HeartbeatAgentConfig[];
}

export interface HeartbeatAgentConfig {
  readonly agentId: string;
  readonly intervals?: Partial<HeartbeatConfig["intervals"]>;
  readonly activeHours?: ActiveHoursConfig;
}
