import { describe, it, expect } from "vitest";
import { responseCadenceRule } from "../../src/intelligence/inference/rules/response-cadence.js";
import type { ProfileSignal } from "../../src/onboarding/types.js";

const now = Date.now();

function makeSignal(observedAt: number): ProfileSignal {
  return {
    id: `rc-${observedAt}`,
    senderId: "u1",
    signalType: "active_hour",
    value: "10",
    observedAt,
    raw: {},
  };
}

describe("responseCadenceRule", () => {
  it("has correct id and metadata", () => {
    expect(responseCadenceRule.id).toBe("response_cadence");
    expect(responseCadenceRule.minSamples).toBe(5);
    expect(responseCadenceRule.cooldownMs).toBe(3_600_000);
  });

  it("returns null when fewer than 5 signals", () => {
    const signals = [makeSignal(now), makeSignal(now - 10_000), makeSignal(now - 20_000)];
    const result = responseCadenceRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("returns null when fewer than 3 valid gaps", () => {
    // 5 signals but only 1 valid gap (others >24h)
    const signals = [
      makeSignal(now),
      makeSignal(now - 10_000),
      makeSignal(now - 2 * 86_400_000),
      makeSignal(now - 4 * 86_400_000),
      makeSignal(now - 6 * 86_400_000),
    ];
    const result = responseCadenceRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("detects realtime cadence (median < 60s)", () => {
    const signals = Array.from({ length: 10 }, (_, i) => makeSignal(now - i * 30_000));
    const result = responseCadenceRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("realtime");
  });

  it("detects active cadence (median 1-30 min)", () => {
    const signals = Array.from({ length: 10 }, (_, i) => makeSignal(now - i * 300_000)); // 5 min gaps
    const result = responseCadenceRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("active");
  });

  it("detects async cadence (median 30min-4h)", () => {
    const signals = Array.from({ length: 10 }, (_, i) => makeSignal(now - i * 3_600_000)); // 1h gaps
    const result = responseCadenceRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("async");
  });

  it("detects slow cadence (median > 4h)", () => {
    const signals = Array.from({ length: 10 }, (_, i) => makeSignal(now - i * 21_600_000)); // 6h gaps
    const result = responseCadenceRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("slow");
  });

  it("includes evidence with medianGapMs and sampleGaps", () => {
    const signals = Array.from({ length: 8 }, (_, i) => makeSignal(now - i * 60_000));
    const result = responseCadenceRule.evaluate(signals, null);
    const evidence = JSON.parse(result!.evidence as string);
    expect(evidence).toHaveProperty("medianGapMs");
    expect(evidence).toHaveProperty("sampleGaps");
    expect(evidence).toHaveProperty("medianMinutes");
  });

  it("ignores gaps >= 24h", () => {
    // Signals with some large gaps (>24h) that should be filtered
    const signals = [
      makeSignal(now),
      makeSignal(now - 30_000),
      makeSignal(now - 60_000),
      makeSignal(now - 90_000),
      makeSignal(now - 120_000),
      makeSignal(now - 2 * 86_400_000), // >24h gap — filtered
    ];
    const result = responseCadenceRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("realtime");
  });

  it("confidence increases with more gaps and caps at 0.85", () => {
    const few = Array.from({ length: 6 }, (_, i) => makeSignal(now - i * 60_000));
    const many = Array.from({ length: 40 }, (_, i) => makeSignal(now - i * 60_000));
    const fewResult = responseCadenceRule.evaluate(few, null);
    const manyResult = responseCadenceRule.evaluate(many, null);
    expect(manyResult!.confidence).toBeGreaterThan(fewResult!.confidence);
    expect(manyResult!.confidence).toBeLessThanOrEqual(0.85);
  });
});
