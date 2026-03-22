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

/**
 * Note: TriggerEvaluator always prepends builtinTriggerRules before custom rules.
 * We use a text value ("\x00noop") that is guaranteed not to match any built-in
 * pattern, so built-in rules never fire and only our custom test rules run.
 * If a new built-in rule is added that matches this text, tests here will break
 * and should be updated with a different sentinel value.
 */
function makeMsg(): any {
  return {
    channelId: "tg",
    senderId: "u1",
    text: "\x00noop",
    chatId: "c1",
    chatType: "dm",
    id: "m1",
    timestamp: 0,
    raw: {},
    senderName: "",
  };
}

function makeIntelligenceStore() {
  return { writeDerivedSignal: vi.fn() };
}

function makeIntentStore() {
  return { addIntent: vi.fn() };
}

function makeBus() {
  return { emit: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("TriggerEvaluator — action branch coverage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flag_for_prompt: logs and collects result when action is flag_for_prompt", () => {
    const logger = makeLogger();
    const bus = makeBus();
    const store = makeIntelligenceStore();

    const rule: TriggerRule = {
      id: "flag-rule",
      enabled: true,
      priority: 1,
      evaluate: () => ({
        action: "flag_for_prompt",
        payload: { flag: "HEARTBEAT_CONTEXT" },
        ruleId: "flag-rule",
      }),
    };

    const evaluator = new TriggerEvaluator(store as any, null, bus as any, logger as any, [rule]);
    const results = evaluator.evaluate(makeMsg(), []);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("flag_for_prompt");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: "flag-rule", flag: "HEARTBEAT_CONTEXT" }),
      "Trigger flagged for prompt",
    );
    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "trigger_fired", senderId: "u1" }),
    );
  });

  it("update_signal: calls writeDerivedSignal when signalType and value are present", () => {
    const logger = makeLogger();
    const bus = makeBus();
    const store = makeIntelligenceStore();

    const rule: TriggerRule = {
      id: "signal-rule",
      enabled: true,
      priority: 1,
      evaluate: () => ({
        action: "update_signal",
        payload: { signalType: "mood", value: "positive", confidence: 0.9 },
        ruleId: "signal-rule",
      }),
    };

    const evaluator = new TriggerEvaluator(store as any, null, bus as any, logger as any, [rule]);
    const results = evaluator.evaluate(makeMsg(), []);

    expect(results).toHaveLength(1);
    expect(store.writeDerivedSignal).toHaveBeenCalledOnce();
    expect(store.writeDerivedSignal).toHaveBeenCalledWith(
      expect.objectContaining({ signalType: "mood", value: "positive", confidence: 0.9 }),
    );
  });

  it("update_signal: skips writeDerivedSignal when signalType is missing", () => {
    const logger = makeLogger();
    const bus = makeBus();
    const store = makeIntelligenceStore();

    const rule: TriggerRule = {
      id: "signal-no-type",
      enabled: true,
      priority: 1,
      evaluate: () => ({
        action: "update_signal",
        payload: { value: "positive" }, // no signalType
        ruleId: "signal-no-type",
      }),
    };

    const evaluator = new TriggerEvaluator(store as any, null, bus as any, logger as any, [rule]);
    evaluator.evaluate(makeMsg(), []);

    expect(store.writeDerivedSignal).not.toHaveBeenCalled();
  });

  it("update_signal: skips writeDerivedSignal when value is missing (signalType present)", () => {
    const logger = makeLogger();
    const bus = makeBus();
    const store = makeIntelligenceStore();

    const rule: TriggerRule = {
      id: "signal-no-value",
      enabled: true,
      priority: 1,
      evaluate: () => ({
        action: "update_signal",
        payload: { signalType: "mood" }, // signalType present, value absent
        ruleId: "signal-no-value",
      }),
    };

    const evaluator = new TriggerEvaluator(store as any, null, bus as any, logger as any, [rule]);
    evaluator.evaluate(makeMsg(), []);

    // Guard requires both signalType AND value — value missing means no write
    expect(store.writeDerivedSignal).not.toHaveBeenCalled();
  });

  it("update_signal: uses default confidence 0.7 when not provided", () => {
    const store = makeIntelligenceStore();
    const bus = makeBus();
    const logger = makeLogger();

    const rule: TriggerRule = {
      id: "signal-no-confidence",
      enabled: true,
      priority: 1,
      evaluate: () => ({
        action: "update_signal",
        payload: { signalType: "energy", value: "high" },
        ruleId: "signal-no-confidence",
      }),
    };

    const evaluator = new TriggerEvaluator(store as any, null, bus as any, logger as any, [rule]);
    evaluator.evaluate(makeMsg(), []);

    expect(store.writeDerivedSignal).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 0.7 }),
    );
  });

  it("error handler: catches and logs when rule.evaluate throws", () => {
    const logger = makeLogger();
    const bus = makeBus();
    const store = makeIntelligenceStore();

    const rule: TriggerRule = {
      id: "exploding-rule",
      enabled: true,
      priority: 1,
      evaluate: () => {
        throw new Error("kaboom");
      },
    };

    const evaluator = new TriggerEvaluator(store as any, null, bus as any, logger as any, [rule]);
    const results = evaluator.evaluate(makeMsg(), []);

    expect(results).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: "exploding-rule" }),
      "Trigger rule evaluation failed",
    );
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("enabled: false — rule is skipped entirely, no bus.emit, no store calls", () => {
    const logger = makeLogger();
    const bus = makeBus();
    const store = makeIntelligenceStore();
    const intentStore = makeIntentStore();

    const rule: TriggerRule = {
      id: "disabled-rule",
      enabled: false, // must be skipped
      priority: 1,
      evaluate: () => ({
        action: "flag_for_prompt",
        payload: { flag: "SHOULD_NOT_FIRE" },
        ruleId: "disabled-rule",
      }),
    };

    const evaluator = new TriggerEvaluator(store as any, intentStore as any, bus as any, logger as any, [rule]);
    const results = evaluator.evaluate(makeMsg(), []);

    expect(results).toHaveLength(0);
    expect(bus.emit).not.toHaveBeenCalled();
    expect(store.writeDerivedSignal).not.toHaveBeenCalled();
    expect(intentStore.addIntent).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("create_intent: calls intentStore.addIntent when intentStore is provided", () => {
    const logger = makeLogger();
    const bus = makeBus();
    const store = makeIntelligenceStore();
    const intentStore = makeIntentStore();

    const rule: TriggerRule = {
      id: "intent-rule",
      enabled: true,
      priority: 1,
      evaluate: () => ({
        action: "create_intent",
        payload: { what: "send reminder", why: "user requested", confidence: 0.95 },
        ruleId: "intent-rule",
      }),
    };

    const evaluator = new TriggerEvaluator(store as any, intentStore as any, bus as any, logger as any, [rule]);
    evaluator.evaluate(makeMsg(), []);

    expect(intentStore.addIntent).toHaveBeenCalledOnce();
    expect(intentStore.addIntent).toHaveBeenCalledWith(
      expect.objectContaining({ what: "send reminder", why: "user requested", confidence: 0.95 }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ what: "send reminder", ruleId: "intent-rule" }),
      "Trigger created intent",
    );
  });

  it("create_intent: does NOT call addIntent when intentStore is null", () => {
    const logger = makeLogger();
    const bus = makeBus();
    const store = makeIntelligenceStore();

    const rule: TriggerRule = {
      id: "intent-null-store",
      enabled: true,
      priority: 1,
      evaluate: () => ({
        action: "create_intent",
        payload: { what: "send reminder" },
        ruleId: "intent-null-store",
      }),
    };

    const evaluator = new TriggerEvaluator(store as any, null, bus as any, logger as any, [rule]);
    const results = evaluator.evaluate(makeMsg(), []);

    // No crash, result still collected
    expect(results).toHaveLength(1);
  });
});
