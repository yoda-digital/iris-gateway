import type { InferenceRule } from "../engine.js";
import type { ProfileSignal } from "../../../onboarding/types.js";
import type { DerivedSignal } from "../../types.js";

/**
 * Detects user's session pattern.
 * Groups messages into sessions (gap > 30min = new session).
 *
 * Short bursts (avg 1-5 msgs) vs long sessions (avg 10+ msgs).
 */
export const sessionPatternRule: InferenceRule = {
  id: "session_pattern",
  inputSignals: ["active_hour"],
  minSamples: 10,
  cooldownMs: 7_200_000, // 2 hours

  evaluate(raw: ProfileSignal[], _existing: DerivedSignal | null) {
    const SESSION_GAP_MS = 1_800_000; // 30 minutes

    const timestamps = raw
      .map((s) => s.observedAt)
      .sort((a, b) => a - b);

    if (timestamps.length < 10) return null;

    // Group into sessions
    const sessions: number[][] = [[timestamps[0]]];
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      if (gap > SESSION_GAP_MS) {
        sessions.push([timestamps[i]]);
      } else {
        sessions[sessions.length - 1].push(timestamps[i]);
      }
    }

    if (sessions.length < 3) return null;

    const sessionLengths = sessions.map((s) => s.length);
    const avgLength = sessionLengths.reduce((a, b) => a + b, 0) / sessionLengths.length;

    let pattern: string;
    if (avgLength <= 3) pattern = "burst";
    else if (avgLength <= 8) pattern = "moderate";
    else pattern = "extended";

    const confidence = Math.min(0.5 + sessions.length * 0.03, 0.85);

    return {
      value: pattern,
      confidence,
      evidence: JSON.stringify({
        sessionCount: sessions.length,
        avgMessagesPerSession: Math.round(avgLength * 10) / 10,
        totalMessages: timestamps.length,
      }),
    };
  },
};
