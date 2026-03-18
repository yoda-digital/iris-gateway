import { describe, it, expect } from "vitest";
import { languageStabilityRule } from "../../src/intelligence/inference/rules/language-stability.js";
import type { ProfileSignal } from "../../src/onboarding/types.js";

const now = Date.now();

function makeLangSignal(lang: string, offset = 0): ProfileSignal {
  return {
    id: `ls-${lang}-${offset}`,
    senderId: "u1",
    signalType: "language",
    value: lang,
    observedAt: now - offset * 1000,
    raw: {},
  };
}

describe("languageStabilityRule", () => {
  it("has correct id and metadata", () => {
    expect(languageStabilityRule.id).toBe("language_stability");
    expect(languageStabilityRule.minSamples).toBe(5);
    expect(languageStabilityRule.cooldownMs).toBe(1_800_000);
  });

  it("returns null when fewer than 5 language signals", () => {
    const signals = [makeLangSignal("en", 1), makeLangSignal("en", 2), makeLangSignal("en", 3)];
    const result = languageStabilityRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("returns null when no language-type signals (filters by signalType)", () => {
    const signals = Array.from({ length: 5 }, (_, i) => ({
      id: `s-${i}`,
      senderId: "u1",
      signalType: "active_hour",
      value: "10",
      observedAt: now - i * 1000,
      raw: {},
    }));
    const result = languageStabilityRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("detects monolingual/stable pattern", () => {
    const signals = Array.from({ length: 10 }, (_, i) => makeLangSignal("ro", i));
    const result = languageStabilityRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("stable:ro");
    expect(result!.confidence).toBe(0.95);
    const evidence = JSON.parse(result!.evidence as string);
    expect(evidence.pattern).toBe("monolingual");
  });

  it("detects bilingual pattern when two langs appear >= 20% each", () => {
    // 7 en + 3 ro = 10 signals; ro is 30% — bilingual
    const signals = [
      ...Array.from({ length: 7 }, (_, i) => makeLangSignal("en", i)),
      ...Array.from({ length: 3 }, (_, i) => makeLangSignal("ro", i + 10)),
    ];
    const result = languageStabilityRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toContain("bilingual:");
    expect(result!.confidence).toBe(0.8);
    const evidence = JSON.parse(result!.evidence as string);
    expect(evidence.pattern).toBe("bilingual");
  });

  it("detects dominant (stable) when one language < 20%", () => {
    // 9 en + 1 ru = 10 signals; ru is 10% — dominant (stable)
    const signals = [
      ...Array.from({ length: 9 }, (_, i) => makeLangSignal("en", i)),
      makeLangSignal("ru", 100),
    ];
    const result = languageStabilityRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toContain("stable:");
    const evidence = JSON.parse(result!.evidence as string);
    expect(evidence.pattern).toBe("dominant");
  });

  it("detects unstable with 3+ languages", () => {
    const signals = [
      ...Array.from({ length: 3 }, (_, i) => makeLangSignal("en", i)),
      ...Array.from({ length: 3 }, (_, i) => makeLangSignal("ro", i + 10)),
      ...Array.from({ length: 4 }, (_, i) => makeLangSignal("ru", i + 20)),
    ];
    const result = languageStabilityRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("unstable");
    expect(result!.confidence).toBe(0.3);
    const evidence = JSON.parse(result!.evidence as string);
    expect(evidence.pattern).toBe("multilingual");
  });

  it("only uses last 20 signals", () => {
    // 25 signals: first 5 are "ru", last 20 are all "en"
    const signals = [
      ...Array.from({ length: 5 }, (_, i) => makeLangSignal("ru", i + 100)), // older
      ...Array.from({ length: 20 }, (_, i) => makeLangSignal("en", i)),      // newer
    ];
    const result = languageStabilityRule.evaluate(signals, null);
    // Should be stable:en (only last 20 = all en)
    expect(result!.value).toBe("stable:en");
  });
});
