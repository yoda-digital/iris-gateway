import { describe, it, expect, vi, beforeEach } from "vitest";
import { metrics } from "../../src/gateway/metrics.js";

vi.mock("../../src/gateway/metrics.js", () => ({
  metrics: {
    intentsTriggered: { inc: vi.fn() },
    messagesReceived: { inc: vi.fn() },
    messagesSent: { inc: vi.fn() },
    messagesErrors: { inc: vi.fn() },
    messageProcessingLatency: { observe: vi.fn() },
    queueDepth: { set: vi.fn() },
    activeConnections: { inc: vi.fn() },
    uptime: { set: vi.fn() },
    systemHealth: { set: vi.fn() },
    arcsDetected: { inc: vi.fn() },
    outcomesLogged: { inc: vi.fn() },
    intelligencePipelineLatency: { observe: vi.fn() },
  },
}));

import { TriggerEvaluator } from "../../src/intelligence/triggers/evaluator.js";
import type { TriggerRule } from "../../src/intelligence/triggers/rules.js";

function makeEvaluator(rules: TriggerRule[] = []) {
  return new TriggerEvaluator(
    { writeDerivedSignal: vi.fn() } as any,
    null,
    { emit: vi.fn() } as any,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    rules,
  );
}

function makeMsg(): any {
  return { channelId: "tg", senderId: "u1", text: "hello", chatId: "c1", chatType: "dm", id: "m1", timestamp: 0, raw: {}, senderName: "" };
}

const alwaysFireRule: TriggerRule = {
  id: "test-rule", enabled: true, priority: 1,
  evaluate: () => ({ action: "inject_prompt", payload: { text: "x" }, ruleId: "test-rule" }),
};

describe("TriggerEvaluator metric instrumentation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("increments intentsTriggered with rule id when rule fires", () => {
    makeEvaluator([alwaysFireRule]).evaluate(makeMsg(), []);
    expect(metrics.intentsTriggered.inc).toHaveBeenCalledWith({ intent_id: "test-rule" });
  });

  it("does not increment intentsTriggered when rule returns null", () => {
    const noMatch: TriggerRule = { id: "no-match", enabled: true, priority: 1, evaluate: () => null };
    makeEvaluator([noMatch]).evaluate(makeMsg(), []);
    expect(metrics.intentsTriggered.inc).not.toHaveBeenCalled();
  });

  it("does not increment intentsTriggered for disabled rules", () => {
    const disabled: TriggerRule = { ...alwaysFireRule, id: "disabled", enabled: false };
    makeEvaluator([disabled]).evaluate(makeMsg(), []);
    expect(metrics.intentsTriggered.inc).not.toHaveBeenCalled();
  });

  it("increments once per matched rule", () => {
    const rule2: TriggerRule = { ...alwaysFireRule, id: "rule-2" };
    makeEvaluator([alwaysFireRule, rule2]).evaluate(makeMsg(), []);
    expect(metrics.intentsTriggered.inc).toHaveBeenCalledTimes(2);
    expect(metrics.intentsTriggered.inc).toHaveBeenCalledWith({ intent_id: "test-rule" });
    expect(metrics.intentsTriggered.inc).toHaveBeenCalledWith({ intent_id: "rule-2" });
  });
});
