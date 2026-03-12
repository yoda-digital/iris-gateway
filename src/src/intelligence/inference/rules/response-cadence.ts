import type { InferenceRule } from "../engine.js";
import type { ProfileSignal } from "../../../onboarding/types.js";
import type { DerivedSignal } from "../../types.js";

/**
 * Detects user's typical response cadence.
 * Measures median time between consecutive messages.
 *
 * <60s = realtime, <30min = active, <4h = async, >4h = slow
 */
export const responseCadenceRule: InferenceRule = {
  id: "response_cadence",
  inputSignals: ["active_hour"],
  minSamples: 5,
  cooldownMs: 3_600_000, // 1 hour

  evaluate(raw: ProfileSignal[], _existing: DerivedSignal | null) {
    // Get timestamps sorted chronologically
    const timestamps = raw
      .map((s) => s.observedAt)
      .sort((a, b) => a - b);

    if (timestamps.length < 5) return null;

    // Calculate inter-message gaps (only gaps < 24h — ignore session breaks)
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      if (gap > 0 && gap < 86_400_000) { // < 24h
        gaps.push(gap);
      }
    }

    if (gaps.length < 3) return null;

    // Median gap
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    let cadence: string;
    if (median < 60_000) cadence = "realtime";
    else if (median < 1_800_000) cadence = "active";
    else if (median < 14_400_000) cadence = "async";
    else cadence = "slow";

    const confidence = Math.min(0.5 + gaps.length * 0.03, 0.85);

    return {
      value: cadence,
      confidence,
      evidence: JSON.stringify({
        medianGapMs: median,
        sampleGaps: gaps.length,
        medianMinutes: Math.round(median / 60_000),
      }),
    };
  },
};
