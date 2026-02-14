// ── Derived Signals (Phase 1) ──

export interface DerivedSignal {
  readonly id: string;
  readonly senderId: string;
  readonly channelId: string | null;
  readonly signalType: string;
  readonly value: string;
  readonly confidence: number;
  readonly evidence: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number | null;
}

export interface InferenceLogEntry {
  readonly ruleId: string;
  readonly senderId: string;
  readonly result: "produced" | "skipped" | "unchanged";
  readonly details: string | null;
  readonly executedAt: number;
}

// ── Trigger Rules (Phase 1) ──

export interface TriggerRuleDef {
  readonly id: string;
  readonly ruleType: "regex" | "signal_threshold" | "temporal" | "compound";
  readonly pattern: Record<string, unknown>;
  readonly action: "create_intent" | "update_signal" | "flag_for_prompt";
  readonly actionParams: Record<string, unknown>;
  readonly enabled: boolean;
  readonly priority: number;
}

export interface TriggerResult {
  readonly ruleId: string;
  readonly action: "create_intent" | "update_signal" | "flag_for_prompt";
  readonly payload: Record<string, unknown>;
}

// ── Proactive Outcomes (Phase 2A) ──

export interface ProactiveOutcome {
  readonly id: string;
  readonly intentId: string;
  readonly senderId: string;
  readonly channelId: string;
  readonly category: string;
  readonly sentAt: number;
  readonly engaged: boolean;
  readonly engagedAt: number | null;
  readonly responseQuality: "positive" | "neutral" | "negative" | "ignored" | null;
  readonly timeToEngageMs: number | null;
  readonly dayOfWeek: number;
  readonly hourOfDay: number;
  readonly createdAt: number;
}

export interface CategoryRate {
  readonly category: string;
  readonly rate: number;
  readonly count: number;
  readonly responded: number;
  readonly avgResponseMs: number | null;
}

export interface TimingPattern {
  readonly bestDays: number[];
  readonly bestHours: number[];
  readonly worstDays: number[];
  readonly worstHours: number[];
}

// ── Memory Arcs (Phase 2B) ──

export type ArcStatus = "active" | "resolved" | "stale" | "abandoned";

export interface MemoryArc {
  readonly id: string;
  readonly senderId: string;
  readonly title: string;
  readonly status: ArcStatus;
  readonly summary: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly resolvedAt: number | null;
  readonly staleDays: number;
}

export interface ArcEntry {
  readonly id: string;
  readonly arcId: string;
  readonly content: string;
  readonly source: "conversation" | "compaction" | "proactive" | "tool";
  readonly memoryId: string | null;
  readonly createdAt: number;
}

// ── Goals (Phase 3A) ──

export type GoalStatus = "active" | "paused" | "completed" | "abandoned";

export interface Goal {
  readonly id: string;
  readonly senderId: string;
  readonly channelId: string;
  readonly arcId: string | null;
  readonly description: string;
  readonly status: GoalStatus;
  readonly successCriteria: string | null;
  readonly progressNotes: string;
  readonly nextAction: string | null;
  readonly nextActionDue: number | null;
  readonly priority: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

// ── Cross-Channel (Phase 3B) ──

export interface ChannelPresence {
  readonly channelId: string;
  readonly lastMessageAt: number;
  readonly messageCountLast7d: number;
  readonly topicHint: string | null;
}

export interface ChannelPreference {
  readonly channelId: string;
  readonly confidence: number;
  readonly reason: string;
}

export interface CrossChannelContext {
  readonly channels: ChannelPresence[];
  readonly preferredChannel: ChannelPreference;
  readonly presenceHint: "online_now" | "recent" | "away" | "unknown";
}

// ── Health Trends (Phase 4) ──

export interface TrendResult {
  readonly component: string;
  readonly metric: string;
  readonly trend: "improving" | "stable" | "degrading" | "critical_trajectory";
  readonly slope: number;
  readonly predictedThresholdIn: number | null;
  readonly sampleCount: number;
  readonly confidence: number;
}

export type ThrottleLevel = "normal" | "reduced" | "minimal" | "paused";

export interface HealthGateResult {
  readonly throttle: ThrottleLevel;
  readonly availableChannels: string[];
  readonly queuedChannels: string[];
  readonly reason: string;
}

// ── Intelligence Bus Events ──

export type IntelligenceEvent =
  | { type: "signal_derived"; senderId: string; signal: DerivedSignal }
  | { type: "trigger_fired"; senderId: string; result: TriggerResult }
  | { type: "outcome_recorded"; senderId: string; outcome: ProactiveOutcome }
  | { type: "outcome_engaged"; senderId: string; category: string; quality: string }
  | { type: "arc_created"; senderId: string; arc: MemoryArc }
  | { type: "arc_stale"; senderId: string; arcId: string }
  | { type: "goal_created"; senderId: string; goal: Goal }
  | { type: "goal_due"; senderId: string; goalId: string }
  | { type: "health_changed"; component: string; status: string; trend?: TrendResult }
  | { type: "channel_preference_changed"; senderId: string; preferred: string };

// ── Prompt Sections ──

export interface PromptSections {
  readonly arcs: string | null;
  readonly goals: string | null;
  readonly proactiveContext: string | null;
  readonly crossChannel: string | null;
  readonly triggerFlags: string | null;
  readonly healthHints: string | null;
}
