import { describe, it, expect, vi, beforeEach } from "vitest";
import { InferenceEngine } from "../../src/intelligence/inference/engine.js";
import type { InferenceRule } from "../../src/intelligence/inference/engine.js";
import type { IntelligenceStore } from "../../src/intelligence/store.js";
import type { IntelligenceBus } from "../../src/intelligence/bus.js";
import type { DerivedSignal } from "../../src/intelligence/types.js";
import type { SignalStore } from "../../src/onboarding/signals.js";
import type { Logger } from "../../src/logging/logger.js";
import type { ProfileSignal } from "../../src/onboarding/types.js";

const FAKE_SIGNAL: DerivedSignal = {
  id: "sig-1", senderId: "s1", channelId: "c1",
  signalType: "rule-a", value: "high", confidence: 0.9,
  evidence: "evidence", createdAt: 1000, updatedAt: 1000,
};

const RAW_SIGNAL: ProfileSignal = {
  id: "r1", senderId: "s1", channelId: "c1",
  signalType: "msg_freq", value: "10", confidence: 0.8,
  source: "observation", createdAt: 1000, updatedAt: 1000,
};

function makeStore(overrides: Partial<IntelligenceStore> = {}): IntelligenceStore {
  return {
    getLastInferenceRun: vi.fn(() => null),
    logInference: vi.fn(),
    getDerivedSignals: vi.fn(() => []),
    writeDerivedSignal: vi.fn(() => FAKE_SIGNAL),
    ...overrides,
  } as unknown as IntelligenceStore;
}

function makeSignalStore(signals: ProfileSignal[] = [RAW_SIGNAL]): SignalStore {
  return { getSignals: vi.fn(() => signals) } as unknown as SignalStore;
}

function makeBus(): IntelligenceBus {
  return { emit: vi.fn() } as unknown as IntelligenceBus;
}

function makeLogger(): Logger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } as unknown as Logger;
}

function makeRule(overrides: Partial<InferenceRule> = {}): InferenceRule {
  return {
    id: "rule-a",
    inputSignals: ["msg_freq"],
    minSamples: 1,
    cooldownMs: 0,
    evaluate: vi.fn(() => ({ value: "high", confidence: 0.9, evidence: "e" })),
    ...overrides,
  };
}

describe("InferenceEngine", () => {
  let store: IntelligenceStore;
  let signalStore: SignalStore;
  let bus: IntelligenceBus;
  let logger: Logger;

  beforeEach(() => {
    store = makeStore();
    signalStore = makeSignalStore();
    bus = makeBus();
    logger = makeLogger();
  });

  it("returns empty array when no rules", async () => {
    const engine = new InferenceEngine(store, signalStore, bus, [], logger);
    expect(await engine.evaluate("s1", "c1")).toEqual([]);
  });

  it("produces signal when rule matches", async () => {
    const rule = makeRule();
    const engine = new InferenceEngine(store, signalStore, bus, [rule], logger);
    const results = await engine.evaluate("s1", "c1");
    expect(results).toHaveLength(1);
    expect(results[0]).toBe(FAKE_SIGNAL);
    expect(store.writeDerivedSignal).toHaveBeenCalled();
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "signal_derived" }));
    expect(logger.info).toHaveBeenCalled();
  });

  it("skips rule in cooldown", async () => {
    const store2 = makeStore({ getLastInferenceRun: vi.fn(() => Date.now() - 100) });
    const rule = makeRule({ cooldownMs: 60_000 });
    const engine = new InferenceEngine(store2, signalStore, bus, [rule], logger);
    const results = await engine.evaluate("s1", "c1");
    expect(results).toHaveLength(0);
    expect(store2.writeDerivedSignal).not.toHaveBeenCalled();
  });

  it("skips rule with insufficient samples", async () => {
    const rule = makeRule({ minSamples: 5 });
    const engine = new InferenceEngine(store, signalStore, bus, [rule], logger);
    const results = await engine.evaluate("s1", "c1");
    expect(results).toHaveLength(0);
    expect(store.logInference).toHaveBeenCalledWith(expect.objectContaining({ result: "skipped" }));
  });

  it("logs skipped when rule.evaluate returns null", async () => {
    const rule = makeRule({ evaluate: vi.fn(() => null) });
    const engine = new InferenceEngine(store, signalStore, bus, [rule], logger);
    const results = await engine.evaluate("s1", "c1");
    expect(results).toHaveLength(0);
    expect(store.logInference).toHaveBeenCalledWith(expect.objectContaining({ result: "skipped", details: null }));
  });

  it("logs unchanged when value and confidence unchanged (<0.05 delta)", async () => {
    const existing = { ...FAKE_SIGNAL, value: "high", confidence: 0.9 };
    const store2 = makeStore({ getDerivedSignals: vi.fn(() => [existing]) });
    const rule = makeRule({ evaluate: vi.fn(() => ({ value: "high", confidence: 0.92, evidence: "e" })) });
    const engine = new InferenceEngine(store2, signalStore, bus, [rule], logger);
    const results = await engine.evaluate("s1", "c1");
    expect(results).toHaveLength(0);
    expect(store2.logInference).toHaveBeenCalledWith(expect.objectContaining({ result: "unchanged" }));
  });

  it("produces new signal when confidence changes significantly", async () => {
    const existing = { ...FAKE_SIGNAL, value: "high", confidence: 0.5 };
    const store2 = makeStore({ getDerivedSignals: vi.fn(() => [existing]), writeDerivedSignal: vi.fn(() => FAKE_SIGNAL) });
    const rule = makeRule({ evaluate: vi.fn(() => ({ value: "high", confidence: 0.9, evidence: "e" })) });
    const engine = new InferenceEngine(store2, signalStore, bus, [rule], logger);
    const results = await engine.evaluate("s1", "c1");
    expect(results).toHaveLength(1);
  });

  it("produces signal when value changes even if confidence similar", async () => {
    const existing = { ...FAKE_SIGNAL, value: "low", confidence: 0.9 };
    const store2 = makeStore({ getDerivedSignals: vi.fn(() => [existing]), writeDerivedSignal: vi.fn(() => FAKE_SIGNAL) });
    const rule = makeRule({ evaluate: vi.fn(() => ({ value: "high", confidence: 0.9, evidence: "e" })) });
    const engine = new InferenceEngine(store2, signalStore, bus, [rule], logger);
    expect(await engine.evaluate("s1", "c1")).toHaveLength(1);
  });

  it("filters signals by inputSignals type", async () => {
    const rawSignals: ProfileSignal[] = [
      { ...RAW_SIGNAL, signalType: "msg_freq" },
      { ...RAW_SIGNAL, id: "r2", signalType: "other_type" },
    ];
    const ss = makeSignalStore(rawSignals);
    const rule = makeRule({ inputSignals: ["msg_freq"], minSamples: 1 });
    const engine = new InferenceEngine(store, ss, bus, [rule], logger);
    await engine.evaluate("s1", "c1");
    expect(rule.evaluate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ signalType: "msg_freq" })]),
      null
    );
  });

  it("catches and logs rule errors without throwing", async () => {
    const rule = makeRule({ evaluate: vi.fn(() => { throw new Error("boom"); }) });
    const engine = new InferenceEngine(store, signalStore, bus, [rule], logger);
    await expect(engine.evaluate("s1", "c1")).resolves.toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("logs produced inference result", async () => {
    const rule = makeRule();
    const engine = new InferenceEngine(store, signalStore, bus, [rule], logger);
    await engine.evaluate("s1", "c1");
    expect(store.logInference).toHaveBeenCalledWith(expect.objectContaining({ result: "produced" }));
  });

  it("processes multiple rules independently", async () => {
    const ruleA = makeRule({ id: "rule-a", inputSignals: ["msg_freq"] });
    const ruleB = makeRule({ id: "rule-b", inputSignals: ["msg_freq"] });
    const store2 = makeStore({ writeDerivedSignal: vi.fn(() => FAKE_SIGNAL) });
    const engine = new InferenceEngine(store2, signalStore, bus, [ruleA, ruleB], logger);
    const results = await engine.evaluate("s1", "c1");
    expect(results).toHaveLength(2);
  });
});
