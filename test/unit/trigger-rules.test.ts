import { describe, it, expect } from "vitest";
import { builtinTriggerRules } from "../../src/intelligence/triggers/rules.js";
import type { InboundMessage } from "../../src/channels/adapter.js";
import type { DerivedSignal } from "../../src/intelligence/types.js";

const msg: InboundMessage = {
  id: "msg-1",
  channelId: "test",
  chatId: "c1",
  chatType: "dm",
  senderId: "u1",
  senderName: "Test User",
  text: "",
  timestamp: Date.now(),
  raw: {},
};

const noSignals: DerivedSignal[] = [];

function findRule(id: string) {
  return builtinTriggerRules.find((r) => r.id === id)!;
}

describe("tomorrowIntent rule", () => {
  const rule = findRule("tomorrow_intent");

  it("detects English 'tomorrow'", () => {
    const result = rule.evaluate("I'll do it tomorrow", msg, noSignals);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("create_intent");
  });

  it("detects Romanian 'maine'", () => {
    const result = rule.evaluate("Maine voi face curat", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("detects Russian 'завтра'", () => {
    const result = rule.evaluate("Завтра пойду в зал", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("detects Spanish 'mañana'", () => {
    const result = rule.evaluate("Lo haré mañana por la tarde", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("detects Turkish 'yarın'", () => {
    const result = rule.evaluate("Yarın görüşürüz", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("does NOT trigger on questions about tomorrow", () => {
    const result = rule.evaluate("What happens tomorrow?", msg, noSignals);
    expect(result).toBeNull();
  });

  it("does NOT trigger on unrelated text", () => {
    const result = rule.evaluate("The weather is nice today", msg, noSignals);
    expect(result).toBeNull();
  });

  it("has confidence 0.65", () => {
    const result = rule.evaluate("I'll finish it tomorrow", msg, noSignals);
    expect(result).not.toBeNull();
    expect(result!.payload.confidence).toBe(0.65);
  });
});

describe("timeMention rule", () => {
  const rule = findRule("time_mention");

  it("detects 24h time format", () => {
    const result = rule.evaluate("Встреча в 15:30", msg, noSignals);
    expect(result).not.toBeNull();
    expect(result!.payload.flag).toContain("15:30");
  });

  it("detects 12h time format with am/pm", () => {
    const result = rule.evaluate("Meet me at 3pm", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("detects 12h with colon", () => {
    const result = rule.evaluate("Let's meet at 3:30pm", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("rejects invalid hours (>23)", () => {
    const result = rule.evaluate("item 25:00 in list", msg, noSignals);
    expect(result).toBeNull();
  });

  it("does NOT trigger on plain numbers", () => {
    const result = rule.evaluate("I have 3 cats", msg, noSignals);
    expect(result).toBeNull();
  });
});

describe("dateMention rule", () => {
  const rule = findRule("date_mention");

  it("detects date formats universally", () => {
    const result = rule.evaluate("Deadline is 15/03/2026", msg, noSignals);
    expect(result).not.toBeNull();
    expect(result!.payload.flag).toContain("15/03/2026");
  });
});
