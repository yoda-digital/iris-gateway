import type { IntelligenceStore } from "../store.js";
import type { IntelligenceBus } from "../bus.js";
import type { Logger } from "../../logging/logger.js";
import type { CategoryRate, TimingPattern } from "../types.js";
import { categorizeIntent } from "./categorizer.js";

/**
 * Outcome-aware analysis layer.
 * Queries IntelligenceStore for category rates and timing patterns,
 * then determines whether a proactive message should be sent.
 *
 * All deterministic — no AI calls.
 */
export class OutcomeAnalyzer {
  constructor(
    private readonly store: IntelligenceStore,
    private readonly bus: IntelligenceBus,
    private readonly logger: Logger,
  ) {}

  /**
   * Record that a proactive message was sent.
   * Called after PulseEngine successfully delivers a message.
   */
  recordSent(params: {
    intentId: string;
    senderId: string;
    channelId: string;
    what: string;
    category?: string;
  }): void {
    const now = new Date();
    const category = categorizeIntent(params.what, params.category);

    const outcome = this.store.recordOutcome({
      intentId: params.intentId,
      senderId: params.senderId,
      channelId: params.channelId,
      category,
      sentAt: Date.now(),
      dayOfWeek: now.getDay(),
      hourOfDay: now.getHours(),
    });

    this.bus.emit({
      type: "outcome_recorded",
      senderId: params.senderId,
      outcome,
    });

    this.logger.info(
      { intentId: params.intentId, category },
      "Outcome recorded",
    );
  }

  /**
   * Record that a user engaged with a proactive message.
   * Called when a user sends a message after receiving a proactive one.
   */
  recordEngagement(senderId: string, quality: "positive" | "neutral" | "negative" = "neutral"): void {
    const engaged = this.store.markEngaged(senderId, Date.now(), quality);
    if (engaged) {
      this.bus.emit({
        type: "outcome_engaged",
        senderId,
        category: "unknown", // We don't track category on engagement side
        quality,
      });
      this.logger.info({ senderId, quality }, "Outcome engagement recorded");
    }
  }

  /**
   * Determine if a proactive message should be sent to this user now.
   * Uses category engagement rates and timing patterns.
   */
  shouldSend(senderId: string, what: string, intentCategory?: string): { send: boolean; reason: string } {
    const category = categorizeIntent(what, intentCategory);
    const rates = this.store.getCategoryRates(senderId);
    const timing = this.store.getTimingPatterns(senderId);

    // Find rate for this category
    const categoryRate = rates.find((r) => r.category === category);

    // New category with no history — allow
    if (!categoryRate || categoryRate.count < 3) {
      return { send: true, reason: `new_category:${category}` };
    }

    // Category engagement rate below 15% with 5+ samples — skip
    if (categoryRate.rate < 0.15 && categoryRate.count >= 5) {
      return {
        send: false,
        reason: `low_engagement:${category}=${Math.round(categoryRate.rate * 100)}%`,
      };
    }

    // Check timing — is now a bad time?
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();

    if (timing.worstDays.includes(currentDay) && timing.worstHours.includes(currentHour)) {
      return {
        send: false,
        reason: `bad_timing:day=${currentDay},hour=${currentHour}`,
      };
    }

    return { send: true, reason: `ok:${category}=${Math.round((categoryRate.rate) * 100)}%` };
  }

  /**
   * Get engagement summary for a user.
   * Used by the prompt assembler to inject context.
   */
  getSummary(senderId: string): {
    rates: CategoryRate[];
    timing: TimingPattern;
    topCategory: string | null;
    worstCategory: string | null;
  } {
    const rates = this.store.getCategoryRates(senderId);
    const timing = this.store.getTimingPatterns(senderId);

    const sorted = [...rates].sort((a, b) => b.rate - a.rate);
    const topCategory = sorted.length > 0 ? sorted[0].category : null;
    const worstCategory = sorted.length > 0 ? sorted[sorted.length - 1].category : null;

    return { rates, timing, topCategory, worstCategory };
  }
}
