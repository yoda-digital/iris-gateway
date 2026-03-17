import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutcomeAnalyzer } from "../../src/intelligence/outcomes/analyzer.js";

function makeStore(overrides: Partial<{
  recordOutcome: ReturnType<typeof vi.fn>;
  markEngaged: ReturnType<typeof vi.fn>;
  getCategoryRates: ReturnType<typeof vi.fn>;
  getTimingPatterns: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    recordOutcome: vi.fn().mockReturnValue({ id: "out-1" }),
    markEngaged: vi.fn().mockReturnValue(true),
    getCategoryRates: vi.fn().mockReturnValue([]),
    getTimingPatterns: vi.fn().mockReturnValue({ worstDays: [], worstHours: [] }),
    ...overrides,
  };
}

function makeBus() {
  return { emit: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("OutcomeAnalyzer.recordSent", () => {
  it("calls store.recordOutcome and bus.emit", () => {
    const store = makeStore();
    const bus = makeBus();
    const logger = makeLogger();
    const analyzer = new OutcomeAnalyzer(store as any, bus as any, logger as any);

    analyzer.recordSent({ intentId: "i1", senderId: "s1", channelId: "c1", what: "check weather" });

    expect(store.recordOutcome).toHaveBeenCalledOnce();
    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "outcome_recorded", senderId: "s1" }));
    expect(logger.info).toHaveBeenCalled();
  });

  it("uses provided category when given", () => {
    const store = makeStore();
    const bus = makeBus();
    const logger = makeLogger();
    const analyzer = new OutcomeAnalyzer(store as any, bus as any, logger as any);

    analyzer.recordSent({ intentId: "i2", senderId: "s2", channelId: "c2", what: "hello", category: "greeting" });

    const call = store.recordOutcome.mock.calls[0][0];
    expect(call.senderId).toBe("s2");
    expect(call.intentId).toBe("i2");
  });
});

describe("OutcomeAnalyzer.recordEngagement", () => {
  it("emits outcome_engaged when markEngaged returns true", () => {
    const store = makeStore({ markEngaged: vi.fn().mockReturnValue(true) });
    const bus = makeBus();
    const logger = makeLogger();
    const analyzer = new OutcomeAnalyzer(store as any, bus as any, logger as any);

    analyzer.recordEngagement("sender1", "positive");

    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "outcome_engaged", senderId: "sender1", quality: "positive" }));
    expect(logger.info).toHaveBeenCalled();
  });

  it("does not emit when markEngaged returns false", () => {
    const store = makeStore({ markEngaged: vi.fn().mockReturnValue(false) });
    const bus = makeBus();
    const logger = makeLogger();
    const analyzer = new OutcomeAnalyzer(store as any, bus as any, logger as any);

    analyzer.recordEngagement("sender1");

    expect(bus.emit).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("defaults quality to neutral", () => {
    const store = makeStore({ markEngaged: vi.fn().mockReturnValue(true) });
    const bus = makeBus();
    const logger = makeLogger();
    const analyzer = new OutcomeAnalyzer(store as any, bus as any, logger as any);

    analyzer.recordEngagement("s1");

    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ quality: "neutral" }));
  });
});

describe("OutcomeAnalyzer.shouldSend", () => {
  it("allows new category with no history", () => {
    const store = makeStore({ getCategoryRates: vi.fn().mockReturnValue([]) });
    const analyzer = new OutcomeAnalyzer(store as any, makeBus() as any, makeLogger() as any);

    const result = analyzer.shouldSend("s1", "hello world");
    expect(result.send).toBe(true);
    expect(result.reason).toMatch(/new_category/);
  });

  it("allows category with fewer than 3 samples", () => {
    const store = makeStore({
      getCategoryRates: vi.fn().mockReturnValue([{ category: "greeting", rate: 0.1, count: 2 }]),
    });
    const analyzer = new OutcomeAnalyzer(store as any, makeBus() as any, makeLogger() as any);

    const result = analyzer.shouldSend("s1", "hello", "greeting");
    expect(result.send).toBe(true);
  });

  it("blocks when engagement rate < 15% with 5+ samples", () => {
    const store = makeStore({
      getCategoryRates: vi.fn().mockReturnValue([{ category: "general", rate: 0.05, count: 10 }]),
      getTimingPatterns: vi.fn().mockReturnValue({ worstDays: [], worstHours: [] }),
    });
    const analyzer = new OutcomeAnalyzer(store as any, makeBus() as any, makeLogger() as any);

    const result = analyzer.shouldSend("s1", "buy now", "general");
    expect(result.send).toBe(false);
    expect(result.reason).toMatch(/low_engagement/);
  });

  it("blocks on bad timing (worst day + worst hour)", () => {
    const now = new Date();
    const store = makeStore({
      getCategoryRates: vi.fn().mockReturnValue([{ category: "task", rate: 0.5, count: 8 }]),
      getTimingPatterns: vi.fn().mockReturnValue({
        worstDays: [now.getDay()],
        worstHours: [now.getHours()],
      }),
    });
    const analyzer = new OutcomeAnalyzer(store as any, makeBus() as any, makeLogger() as any);

    const result = analyzer.shouldSend("s1", "breaking news", "task");
    expect(result.send).toBe(false);
    expect(result.reason).toMatch(/bad_timing/);
  });

  it("allows when good engagement rate and neutral timing", () => {
    const store = makeStore({
      getCategoryRates: vi.fn().mockReturnValue([{ category: "work", rate: 0.6, count: 8 }]),
      getTimingPatterns: vi.fn().mockReturnValue({ worstDays: [], worstHours: [] }),
    });
    const analyzer = new OutcomeAnalyzer(store as any, makeBus() as any, makeLogger() as any);

    const result = analyzer.shouldSend("s1", "daily update", "work");
    expect(result.send).toBe(true);
    expect(result.reason).toMatch(/ok:/);
  });
});

describe("OutcomeAnalyzer.getSummary", () => {
  it("returns empty summary when no rates", () => {
    const store = makeStore({
      getCategoryRates: vi.fn().mockReturnValue([]),
      getTimingPatterns: vi.fn().mockReturnValue({ worstDays: [], worstHours: [] }),
    });
    const analyzer = new OutcomeAnalyzer(store as any, makeBus() as any, makeLogger() as any);

    const summary = analyzer.getSummary("s1");
    expect(summary.rates).toEqual([]);
    expect(summary.topCategory).toBeNull();
    expect(summary.worstCategory).toBeNull();
  });

  it("returns top and worst categories", () => {
    const store = makeStore({
      getCategoryRates: vi.fn().mockReturnValue([
        { category: "low", rate: 0.1, count: 5 },
        { category: "high", rate: 0.9, count: 5 },
      ]),
      getTimingPatterns: vi.fn().mockReturnValue({ worstDays: [], worstHours: [] }),
    });
    const analyzer = new OutcomeAnalyzer(store as any, makeBus() as any, makeLogger() as any);

    const summary = analyzer.getSummary("s1");
    expect(summary.topCategory).toBe("high");
    expect(summary.worstCategory).toBe("low");
  });
});
