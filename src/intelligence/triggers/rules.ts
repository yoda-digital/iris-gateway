import type { InboundMessage } from "../../channels/adapter.js";
import type { DerivedSignal, TriggerResult } from "../types.js";

export interface TriggerRule {
  readonly id: string;
  readonly enabled: boolean;
  readonly priority: number;
  evaluate(
    text: string,
    msg: InboundMessage,
    derivedSignals: DerivedSignal[],
  ): TriggerResult | null;
}

// ── Built-in trigger rules ──

/**
 * "Tomorrow" words covering ~95% of global population by native speakers.
 * Single-concept lookup — does NOT grow with features or categories.
 */
const TOMORROW_WORDS = new Set([
  "tomorrow", "maine", "mîine", "завтра", "morgen", "demain", "mañana",
  "domani", "amanhã", "amanha", "yarın", "yarin", "明天", "明日", "내일",
  "कल", "غدا", "พรุ่งนี้", "holnap", "huomenna", "αύριο", "jutro",
]);

const tomorrowIntent: TriggerRule = {
  id: "tomorrow_intent",
  enabled: true,
  priority: 50,
  evaluate(text, _msg) {
    const lower = text.toLowerCase();
    const words = lower.split(/[\s,.:;!]+/);

    // Check if any word matches "tomorrow" in any language
    const hasTomorrow = words.some((w) => TOMORROW_WORDS.has(w));
    if (!hasTomorrow) return null;

    // Skip questions — universal structural check
    const trimmed = text.trim();
    if (trimmed.endsWith("?")) return null;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);

    return {
      ruleId: "tomorrow_intent",
      action: "create_intent",
      payload: {
        what: `Follow up on commitment: "${text.substring(0, 100)}"`,
        why: "User mentioned tomorrow — possible commitment",
        confidence: 0.65,
        executeAt: tomorrow.getTime(),
      },
    };
  },
};

/**
 * Detects date mentions in text.
 * Flags for prompt injection so the AI is aware.
 */
const dateMention: TriggerRule = {
  id: "date_mention",
  enabled: true,
  priority: 40,
  evaluate(text) {
    const datePattern = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/;
    const match = text.match(datePattern);
    if (!match) return null;

    return {
      ruleId: "date_mention",
      action: "flag_for_prompt",
      payload: {
        flag: `[User mentioned date: ${match[0]}]`,
      },
    };
  },
};

/**
 * Detects when a user returns after a long absence.
 * Creates a welcome-back intent for 24h later.
 */
const dormancyRecovery: TriggerRule = {
  id: "dormancy_recovery",
  enabled: true,
  priority: 60,
  evaluate(_text, msg, derivedSignals) {
    const trend = derivedSignals.find((s) => s.signalType === "engagement_trend");

    // If engagement trend shows rising after being declining, this is a recovery
    // We rely on the engagement_trend signal rather than checking lastSeen directly
    // because the inference engine already does that calculation
    if (!trend || trend.value !== "rising") return null;

    // Check if there's evidence of previous decline
    const evidence = trend.evidence ? JSON.parse(trend.evidence) : null;
    if (!evidence || evidence.previousWeek > 0) return null; // Had activity last week — not a real recovery

    return {
      ruleId: "dormancy_recovery",
      action: "create_intent",
      payload: {
        what: `Welcome back check-in for returning user`,
        why: "User returned after period of inactivity",
        confidence: 0.7,
        executeAt: Date.now() + 86_400_000, // 24h later
      },
    };
  },
};

/**
 * When engagement is declining, flag for the AI to be extra helpful.
 */
const engagementDrop: TriggerRule = {
  id: "engagement_drop",
  enabled: true,
  priority: 30,
  evaluate(_text, _msg, derivedSignals) {
    const trend = derivedSignals.find((s) => s.signalType === "engagement_trend");
    if (!trend || trend.value !== "declining") return null;

    return {
      ruleId: "engagement_drop",
      action: "flag_for_prompt",
      payload: {
        flag: "[User engagement is declining — be especially helpful and relevant]",
      },
    };
  },
};

/**
 * Detects time mentions (e.g., "at 3pm", "at 15:00").
 * Flags for prompt so AI can act on scheduling context.
 */
const timeMention: TriggerRule = {
  id: "time_mention",
  enabled: true,
  priority: 35,
  evaluate(text) {
    // Match 24h format (15:30) or 12h format (3pm, 3:30pm, 3 PM)
    const time24 = text.match(/\b(\d{1,2}):(\d{2})\b/);
    const time12 = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

    const match = time24 ?? time12;
    if (!match) return null;

    // Validate hour range to avoid false positives
    const hour = parseInt(match[1], 10);
    if (hour > 23) return null;
    if (time24 && parseInt(match[2], 10) > 59) return null;

    return {
      ruleId: "time_mention",
      action: "flag_for_prompt",
      payload: {
        flag: `[User mentioned time: ${match[0]}]`,
      },
    };
  },
};

export const builtinTriggerRules: TriggerRule[] = [
  tomorrowIntent,
  dateMention,
  dormancyRecovery,
  engagementDrop,
  timeMention,
];
