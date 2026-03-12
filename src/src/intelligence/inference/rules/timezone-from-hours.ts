import type { InferenceRule } from "../engine.js";
import type { ProfileSignal } from "../../../onboarding/types.js";
import type { DerivedSignal } from "../../types.js";

/**
 * Infers timezone from active hour patterns.
 * Clusters active hours into day/evening windows and maps
 * to IANA timezone based on cluster center + language signals.
 */

// Map of hour offsets (from UTC) to timezone, grouped by script/language
const TIMEZONE_HINTS: Record<string, string[]> = {
  "ro": ["Europe/Chisinau", "Europe/Bucharest"],
  "ru": ["Europe/Moscow", "Europe/Chisinau"],
  "uk": ["Europe/Kyiv"],
  "de": ["Europe/Berlin"],
  "fr": ["Europe/Paris"],
  "es": ["Europe/Madrid", "America/Mexico_City"],
  "pt": ["Europe/Lisbon", "America/Sao_Paulo"],
  "ja": ["Asia/Tokyo"],
  "zh": ["Asia/Shanghai"],
  "ko": ["Asia/Seoul"],
  "ar": ["Asia/Riyadh"],
  "hi": ["Asia/Kolkata"],
  "th": ["Asia/Bangkok"],
  "tr": ["Europe/Istanbul"],
};

function clusterHours(hours: number[]): { center: number; spread: number } {
  if (hours.length === 0) return { center: 12, spread: 12 };

  // Convert to radians for circular mean (hours wrap around)
  const sinSum = hours.reduce((s, h) => s + Math.sin((h / 24) * 2 * Math.PI), 0);
  const cosSum = hours.reduce((s, h) => s + Math.cos((h / 24) * 2 * Math.PI), 0);
  const meanAngle = Math.atan2(sinSum / hours.length, cosSum / hours.length);
  const center = ((meanAngle / (2 * Math.PI)) * 24 + 24) % 24;

  // Circular spread
  const r = Math.sqrt((sinSum / hours.length) ** 2 + (cosSum / hours.length) ** 2);
  const spread = (1 - r) * 12; // 0 = all same hour, 12 = uniform

  return { center: Math.round(center), spread };
}

function estimateUtcOffset(activityCenter: number): number {
  // Assume people are most active around 10-20 local time
  // Activity center of 15 (3pm local) maps to offset = center - 15
  const typicalLocalCenter = 15;
  return activityCenter - typicalLocalCenter;
}

export const timezoneFromHoursRule: InferenceRule = {
  id: "timezone_inferred",
  inputSignals: ["active_hour", "language"],
  minSamples: 5,
  cooldownMs: 3_600_000, // 1 hour

  evaluate(raw: ProfileSignal[], existing: DerivedSignal | null) {
    const hourSignals = raw.filter((s) => s.signalType === "active_hour");
    const langSignals = raw.filter((s) => s.signalType === "language");

    if (hourSignals.length < 5) return null;

    // Get last 14 days of hours
    const twoWeeksAgo = Date.now() - 14 * 86_400_000;
    const recentHours = hourSignals
      .filter((s) => s.observedAt > twoWeeksAgo)
      .map((s) => parseInt(s.value, 10))
      .filter((h) => !isNaN(h));

    if (recentHours.length < 5) return null;

    const { center, spread } = clusterHours(recentHours);

    // If spread is too wide, hours are random — can't infer timezone
    if (spread > 8) return null;

    const utcOffset = estimateUtcOffset(center);

    // Try to narrow down using language
    const topLang = langSignals.length > 0
      ? langSignals.sort((a, b) => b.confidence - a.confidence)[0].value
      : null;

    let timezone: string;
    if (topLang && TIMEZONE_HINTS[topLang]) {
      // Pick the timezone hint closest to our estimated offset
      const hints = TIMEZONE_HINTS[topLang];
      timezone = hints[0]; // Default to first hint for the language
    } else {
      // Generic offset-based timezone
      timezone = `UTC${utcOffset >= 0 ? "+" : ""}${utcOffset}`;
    }

    const confidence = Math.min(0.5 + recentHours.length * 0.02, 0.85);

    return {
      value: timezone,
      confidence,
      evidence: JSON.stringify({
        sampleCount: recentHours.length,
        activityCenter: center,
        spread,
        estimatedOffset: utcOffset,
        languageHint: topLang,
      }),
    };
  },
};
