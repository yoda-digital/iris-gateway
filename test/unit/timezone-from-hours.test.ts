import { describe, it, expect } from "vitest";
import { timezoneFromHoursRule } from "../../src/intelligence/inference/rules/timezone-from-hours.js";
import type { ProfileSignal } from "../../src/onboarding/types.js";

let _sigId = 0;
function makeHourSignals(hours: number[], baseTime = Date.now()): ProfileSignal[] {
  return hours.map((h, i) => ({
    id: ++_sigId,
    senderId: "s1",
    channelId: "c1",
    signalType: "active_hour",
    value: String(h),
    confidence: 1,
    observedAt: baseTime - i * 3600_000,
  }));
}

function makeLangSignal(lang: string): ProfileSignal {
  return {
    id: ++_sigId,
    senderId: "s1",
    channelId: "c1",
    signalType: "language",
    value: lang,
    confidence: 0.9,
    observedAt: Date.now(),
  };
}

describe("timezoneFromHoursRule", () => {
  it("has correct id and inputSignals", () => {
    expect(timezoneFromHoursRule.id).toBe("timezone_inferred");
    expect(timezoneFromHoursRule.inputSignals).toContain("active_hour");
    expect(timezoneFromHoursRule.inputSignals).toContain("language");
    expect(timezoneFromHoursRule.minSamples).toBe(5);
  });

  it("returns null when fewer than 5 hour signals", () => {
    const signals = makeHourSignals([14, 15, 16, 17]);
    const result = timezoneFromHoursRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("returns null when hours are older than 14 days", () => {
    const twoWeeksAgo = Date.now() - 15 * 86_400_000;
    const signals = makeHourSignals([14, 15, 16, 17, 18], twoWeeksAgo);
    const result = timezoneFromHoursRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("returns null when hours spread is too wide", () => {
    const wideHours = [0, 3, 6, 9, 12, 15, 18, 21];
    const signals = makeHourSignals(wideHours);
    const result = timezoneFromHoursRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("infers a timezone for clustered hours with language hint", () => {
    const clustered = [14, 15, 15, 16, 14, 15, 16];
    const signals = [...makeHourSignals(clustered), makeLangSignal("ro")];
    const result = timezoneFromHoursRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toMatch(/Europe\/(Chisinau|Bucharest)/);
    expect(result!.confidence).toBeGreaterThan(0.5);
    expect(result!.confidence).toBeLessThanOrEqual(0.85);
  });

  it("returns a string timezone even without matching language", () => {
    const clustered = [10, 11, 10, 11, 10, 11, 10];
    const signals = makeHourSignals(clustered);
    const result = timezoneFromHoursRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(typeof result!.value).toBe("string");
    expect(result!.value.length).toBeGreaterThan(0);
  });

  it("includes evidence with sampleCount and activityCenter", () => {
    const clustered = [15, 15, 15, 15, 15, 15];
    const signals = makeHourSignals(clustered);
    const result = timezoneFromHoursRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    const evidence = JSON.parse(result!.evidence!);
    expect(evidence.sampleCount).toBeGreaterThanOrEqual(5);
    expect(typeof evidence.activityCenter).toBe("number");
    expect(typeof evidence.spread).toBe("number");
  });

  it("confidence is capped at 0.85 for large sample sets", () => {
    const signals = makeHourSignals(Array(50).fill(15));
    const result = timezoneFromHoursRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeLessThanOrEqual(0.85);
  });

  it("single repeated hour yields near-zero spread", () => {
    const signals = makeHourSignals([12, 12, 12, 12, 12]);
    const result = timezoneFromHoursRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    const evidence = JSON.parse(result!.evidence!);
    expect(evidence.spread).toBeLessThan(1);
  });
});
