import type { InferenceRule } from "../engine.js";
import type { ProfileSignal } from "../../../onboarding/types.js";
import type { DerivedSignal } from "../../types.js";

/**
 * Analyzes language signal stability.
 * - All same → stable:{lang} at 0.95 (can stop re-detecting)
 * - Alternating 2 → bilingual:{lang1},{lang2} at 0.8
 * - Chaotic → unstable at 0.3
 */
export const languageStabilityRule: InferenceRule = {
  id: "language_stability",
  inputSignals: ["language"],
  minSamples: 5,
  cooldownMs: 1_800_000, // 30 minutes

  evaluate(raw: ProfileSignal[], _existing: DerivedSignal | null) {
    const langSignals = raw
      .filter((s) => s.signalType === "language")
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, 20); // Last 20 signals

    if (langSignals.length < 5) return null;

    const langs = langSignals.map((s) => s.value);
    const unique = [...new Set(langs)];

    if (unique.length === 1) {
      return {
        value: `stable:${unique[0]}`,
        confidence: 0.95,
        evidence: JSON.stringify({ pattern: "monolingual", lang: unique[0], sampleCount: langs.length }),
      };
    }

    if (unique.length === 2) {
      // Count occurrences
      const counts = new Map<string, number>();
      for (const l of langs) counts.set(l, (counts.get(l) ?? 0) + 1);
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

      // Both must appear at least 20% of the time to count as bilingual
      const minRatio = sorted[1][1] / langs.length;
      if (minRatio >= 0.2) {
        return {
          value: `bilingual:${sorted[0][0]},${sorted[1][0]}`,
          confidence: 0.8,
          evidence: JSON.stringify({
            pattern: "bilingual",
            langs: { [sorted[0][0]]: sorted[0][1], [sorted[1][0]]: sorted[1][1] },
            sampleCount: langs.length,
          }),
        };
      }

      // One language dominates — treat as stable with the dominant one
      return {
        value: `stable:${sorted[0][0]}`,
        confidence: 0.75,
        evidence: JSON.stringify({
          pattern: "dominant",
          primary: sorted[0][0],
          secondary: sorted[1][0],
          ratio: sorted[0][1] / langs.length,
          sampleCount: langs.length,
        }),
      };
    }

    // 3+ languages — unstable
    return {
      value: "unstable",
      confidence: 0.3,
      evidence: JSON.stringify({ pattern: "multilingual", unique: unique.length, sampleCount: langs.length }),
    };
  },
};
