import { describe, it, expect } from "vitest";
import { engagementTrendRule } from "../../src/intelligence/inference/rules/engagement-trend.js";
import type { ProfileSignal } from "../../src/onboarding/types.js";

const now = Date.now();
const oneWeekAgo = now - 7 * 86_400_000;
const twoWeeksAgo = now - 14 * 86_400_000;

function makeSignal(observedAt: number): ProfileSignal {
  return {
    id: `s-${observedAt}`,
    senderId: "u1",
    signalType: "active_hour",
    value: "10",
    observedAt,
    raw: {},
  };
}

describe("engagementTrendRule", () => {
  it("has correct id and metadata", () => {
    expect(engagementTrendRule.id).toBe("engagement_trend");
    expect(engagementTrendRule.minSamples).toBe(3);
    expect(engagementTrendRule.cooldownMs).toBe(3_600_000);
  });

  it("returns null when fewer than 3 signals total", () => {
    const signals = [makeSignal(now - 1000), makeSignal(now - 2000)];
    const result = engagementTrendRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("detects rising trend when current week > previous week by >20%", () => {
    // 5 signals in current week, 1 in previous week → >20% increase
    const signals = [
      makeSignal(now - 1 * 86_400_000),
      makeSignal(now - 2 * 86_400_000),
      makeSignal(now - 3 * 86_400_000),
      makeSignal(now - 4 * 86_400_000),
      makeSignal(now - 5 * 86_400_000),
      makeSignal(oneWeekAgo - 1 * 86_400_000),
    ];
    const result = engagementTrendRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("rising");
  });

  it("detects declining trend when current week < previous week by >20%", () => {
    // 1 in current week, 5 in previous week
    const signals = [
      makeSignal(now - 1 * 86_400_000),
      makeSignal(oneWeekAgo - 1 * 86_400_000),
      makeSignal(oneWeekAgo - 2 * 86_400_000),
      makeSignal(oneWeekAgo - 3 * 86_400_000),
      makeSignal(oneWeekAgo - 4 * 86_400_000),
      makeSignal(oneWeekAgo - 5 * 86_400_000),
    ];
    const result = engagementTrendRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("declining");
  });

  it("detects stable trend when change is within ±20%", () => {
    // 5 current, 5 previous → 0% change
    const signals = [
      makeSignal(now - 1 * 86_400_000),
      makeSignal(now - 2 * 86_400_000),
      makeSignal(now - 3 * 86_400_000),
      makeSignal(now - 4 * 86_400_000),
      makeSignal(now - 5 * 86_400_000),
      makeSignal(oneWeekAgo - 1 * 86_400_000),
      makeSignal(oneWeekAgo - 2 * 86_400_000),
      makeSignal(oneWeekAgo - 3 * 86_400_000),
      makeSignal(oneWeekAgo - 4 * 86_400_000),
      makeSignal(oneWeekAgo - 5 * 86_400_000),
    ];
    const result = engagementTrendRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("stable");
  });

  it("handles zero previous week signals (only current week)", () => {
    // 3 signals all in current week, none in previous
    const signals = [
      makeSignal(now - 1 * 86_400_000),
      makeSignal(now - 2 * 86_400_000),
      makeSignal(now - 3 * 86_400_000),
    ];
    const result = engagementTrendRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("rising");
    expect(result!.confidence).toBe(0.5);
  });

  it("includes evidence JSON with currentWeek and previousWeek", () => {
    const signals = [
      makeSignal(now - 1 * 86_400_000),
      makeSignal(now - 2 * 86_400_000),
      makeSignal(oneWeekAgo - 1 * 86_400_000),
    ];
    const result = engagementTrendRule.evaluate(signals, null);
    const evidence = JSON.parse(result!.evidence as string);
    expect(evidence).toHaveProperty("currentWeek");
    expect(evidence).toHaveProperty("previousWeek");
  });

  it("confidence increases with more signals", () => {
    const few = [
      makeSignal(now - 1 * 86_400_000),
      makeSignal(now - 2 * 86_400_000),
      makeSignal(oneWeekAgo - 1 * 86_400_000),
    ];
    const many = Array.from({ length: 20 }, (_, i) =>
      makeSignal(i < 10 ? now - (i + 1) * 86_400_000 : oneWeekAgo - (i - 9) * 86_400_000)
    );
    const fewResult = engagementTrendRule.evaluate(few, null);
    const manyResult = engagementTrendRule.evaluate(many, null);
    expect(manyResult!.confidence).toBeGreaterThan(fewResult!.confidence);
  });

  it("caps confidence at 0.85", () => {
    const signals = Array.from({ length: 50 }, (_, i) =>
      makeSignal(i < 25 ? now - (i + 1) * 43_200_000 : oneWeekAgo - (i - 24) * 43_200_000)
    );
    const result = engagementTrendRule.evaluate(signals, null);
    expect(result!.confidence).toBeLessThanOrEqual(0.85);
  });
});
