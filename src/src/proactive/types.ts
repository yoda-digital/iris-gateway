export interface ProactiveIntent {
  readonly id: string;
  readonly sessionId: string;
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly what: string;
  readonly why: string | null;
  readonly category?: string | null;
  readonly confidence: number;
  readonly executeAt: number;
  readonly executedAt: number | null;
  readonly result: string | null;
  readonly createdAt: number;
}

export interface ProactiveTrigger {
  readonly id: string;
  readonly type: "dormant_user" | "unanswered" | "engagement_drop" | "external";
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly context: string;
  readonly executeAt: number;
  readonly executedAt: number | null;
  readonly result: string | null;
}

export interface ProactiveLogEntry {
  readonly id: string;
  readonly senderId: string;
  readonly channelId: string;
  readonly type: "intent" | "trigger";
  readonly sourceId: string;
  readonly sentAt: number;
  readonly engaged: boolean;
  readonly engagementAt: number | null;
}

export interface QuotaStatus {
  readonly allowed: boolean;
  readonly sentToday: number;
  readonly limit: number;
  readonly engagementRate: number;
}

export interface DormantUser {
  readonly senderId: string;
  readonly channelId: string;
  readonly name: string | null;
  readonly lastSeen: number;
}

export interface AddIntentParams {
  readonly sessionId: string;
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly what: string;
  readonly why?: string | null;
  readonly confidence?: number;
  readonly executeAt: number;
  readonly category?: string;
}

export interface AddTriggerParams {
  readonly type: ProactiveTrigger["type"];
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly context: string;
  readonly executeAt: number;
}

export interface ProactiveConfig {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;
  readonly passiveScanIntervalMs: number;
  readonly softQuotas: {
    readonly perUserPerDay: number;
    readonly globalPerDay: number;
  };
  readonly dormancy: {
    readonly enabled: boolean;
    readonly thresholdMs: number;
  };
  readonly intentDefaults: {
    readonly minDelayMs: number;
    readonly maxAgeMs: number;
    readonly defaultConfidence: number;
    readonly confidenceThreshold: number;
  };
  readonly quietHours: {
    readonly start: number;
    readonly end: number;
  };
}
