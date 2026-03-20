import { describe, it, expect } from "vitest";
import { sessionPatternRule } from "../../src/intelligence/inference/rules/session-pattern.js";
import type { ProfileSignal } from "../../src/onboarding/types.js";

const now = Date.now();
const SESSION_GAP = 1_800_000; // 30 min

function makeSignal(observedAt: number): ProfileSignal {
  return {
    id: `sp-${observedAt}`,
    senderId: "u1",
    signalType: "active_hour",
    value: "10",
    observedAt,
    raw: {},
  };
}

/** Build N sessions of `msgsPerSession` messages each, spaced by 2h between sessions */
function buildSessions(sessionCount: number, msgsPerSession: number): ProfileSignal[] {
  const signals: ProfileSignal[] = [];
  const sessionInterval = 2 * 3_600_000; // 2h between sessions
  const msgInterval = 60_000; // 1min between messages within session

  for (let s = 0; s < sessionCount; s++) {
    const sessionStart = now - s * sessionInterval - sessionCount * sessionInterval;
    for (let m = 0; m < msgsPerSession; m++) {
      signals.push(makeSignal(sessionStart + m * msgInterval));
    }
  }
  return signals;
}

describe("sessionPatternRule", () => {
  it("has correct id and metadata", () => {
    expect(sessionPatternRule.id).toBe("session_pattern");
    expect(sessionPatternRule.minSamples).toBe(10);
    expect(sessionPatternRule.cooldownMs).toBe(7_200_000);
  });

  it("returns null when fewer than 10 signals", () => {
    const signals = Array.from({ length: 8 }, (_, i) => makeSignal(now - i * 60_000));
    const result = sessionPatternRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("returns null when fewer than 3 sessions", () => {
    // 10 signals all within 30min = 1 session
    const signals = Array.from({ length: 10 }, (_, i) => makeSignal(now - i * 60_000));
    const result = sessionPatternRule.evaluate(signals, null);
    expect(result).toBeNull();
  });

  it("detects burst pattern (avg <= 3 msgs/session)", () => {
    // 5 sessions × 2 messages each = avg 2
    const signals = buildSessions(5, 2);
    const result = sessionPatternRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("burst");
  });

  it("detects moderate pattern (avg 4-8 msgs/session)", () => {
    // 4 sessions × 5 messages each = avg 5
    const signals = buildSessions(4, 5);
    const result = sessionPatternRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("moderate");
  });

  it("detects extended pattern (avg > 8 msgs/session)", () => {
    // 3 sessions × 12 messages each = avg 12
    const signals = buildSessions(3, 12);
    const result = sessionPatternRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("extended");
  });

  it("includes evidence with sessionCount and avgMessagesPerSession", () => {
    const signals = buildSessions(4, 3);
    const result = sessionPatternRule.evaluate(signals, null);
    const evidence = JSON.parse(result!.evidence as string);
    expect(evidence).toHaveProperty("sessionCount");
    expect(evidence).toHaveProperty("avgMessagesPerSession");
    expect(evidence).toHaveProperty("totalMessages");
    expect(evidence.sessionCount).toBe(4);
  });

  it("groups messages correctly across session boundaries", () => {
    // 3 sessions × 4 messages = burst (avg 4 = moderate boundary, <=3 is burst, <=8 is moderate)
    const signals = buildSessions(3, 4);
    const result = sessionPatternRule.evaluate(signals, null);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("moderate");
  });

  it("confidence increases with more sessions and caps at 0.85", () => {
    const few = buildSessions(3, 4);
    const many = buildSessions(15, 4);
    const fewResult = sessionPatternRule.evaluate(few, null);
    const manyResult = sessionPatternRule.evaluate(many, null);
    expect(manyResult!.confidence).toBeGreaterThan(fewResult!.confidence);
    expect(manyResult!.confidence).toBeLessThanOrEqual(0.85);
  });
});
