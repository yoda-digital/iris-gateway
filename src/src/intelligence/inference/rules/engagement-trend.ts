import type { InferenceRule } from "../engine.js";
import type { ProfileSignal } from "../../../onboarding/types.js";
import type { DerivedSignal } from "../../types.js";

/**
 * Detects engagement trend by comparing message frequency
 * in current 7-day window vs previous 7-day window.
 *
 * >20% increase = rising, >20% decrease = declining, else stable.
 */
export const engagementTrendRule: InferenceRule = {
  id: "engagement_trend",
  inputSignals: ["active_hour"], // We use timestamps from any signal as activity proxy
  minSamples: 3,
  cooldownMs: 3_600_000, // 1 hour

  evaluate(raw: ProfileSignal[], _existing: DerivedSignal | null) {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 86_400_000;
    const twoWeeksAgo = now - 14 * 86_400_000;

    // Count messages in each window using signal timestamps
    const currentWeek = raw.filter((s) => s.observedAt > oneWeekAgo).length;
    const previousWeek = raw.filter((s) => s.observedAt > twoWeeksAgo && s.observedAt <= oneWeekAgo).length;

    // Need at least some data in both windows
    if (currentWeek + previousWeek < 3) return null;

    // Handle edge case: no previous week data
    if (previousWeek === 0) {
      return {
        value: currentWeek > 0 ? "rising" : "stable",
        confidence: 0.5,
        evidence: JSON.stringify({ currentWeek, previousWeek, changePercent: null }),
      };
    }

    const changePercent = ((currentWeek - previousWeek) / previousWeek) * 100;

    let trend: string;
    if (changePercent > 20) trend = "rising";
    else if (changePercent < -20) trend = "declining";
    else trend = "stable";

    const confidence = Math.min(0.5 + (currentWeek + previousWeek) * 0.02, 0.85);

    return {
      value: trend,
      confidence,
      evidence: JSON.stringify({
        currentWeek,
        previousWeek,
        changePercent: Math.round(changePercent),
      }),
    };
  },
};
