import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/gateway/metrics.js", () => ({
  metrics: {
    outcomesLogged: { inc: vi.fn() },
    messagesReceived: { inc: vi.fn() },
    messagesSent: { inc: vi.fn() },
    messagesErrors: { inc: vi.fn() },
    messageProcessingLatency: { observe: vi.fn() },
    queueDepth: { set: vi.fn() },
    activeConnections: { inc: vi.fn() },
    uptime: { set: vi.fn() },
    systemHealth: { set: vi.fn() },
    arcsDetected: { inc: vi.fn() },
    intentsTriggered: { inc: vi.fn() },
    intelligencePipelineLatency: { observe: vi.fn() },
  },
}));

import BetterSqlite3 from "better-sqlite3";
import { OutcomesStore } from "../../src/intelligence/outcomes/store.js";

/** Create a real in-memory SQLite VaultDB stub */
function makeRealVaultDb() {
  const rawDb = new BetterSqlite3(":memory:");
  return { raw: () => rawDb } as any;
}

/** Seed a single outcome row for senderId */
function seedOutcome(
  store: OutcomesStore,
  overrides: Partial<{
    intentId: string;
    senderId: string;
    channelId: string;
    category: string;
    sentAt: number;
    dayOfWeek: number;
    hourOfDay: number;
  }> = {},
) {
  return store.recordOutcome({
    intentId: "intent-1",
    senderId: "user-1",
    channelId: "telegram",
    category: "goal",
    sentAt: Date.now(),
    dayOfWeek: 1,
    hourOfDay: 10,
    ...overrides,
  });
}

// ── getOutcome ──────────────────────────────────────────────────────────────

describe("OutcomesStore.getOutcome()", () => {
  let store: OutcomesStore;

  beforeEach(() => {
    store = new OutcomesStore(makeRealVaultDb());
  });

  it("returns null for unknown id", () => {
    expect(store.getOutcome("does-not-exist")).toBeNull();
  });

  it("returns a fully populated ProactiveOutcome after recordOutcome", () => {
    const created = seedOutcome(store, { category: "task", dayOfWeek: 3, hourOfDay: 14 });
    const fetched = store.getOutcome(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.category).toBe("task");
    expect(fetched!.dayOfWeek).toBe(3);
    expect(fetched!.hourOfDay).toBe(14);
    expect(fetched!.engaged).toBe(false);
    expect(fetched!.engagedAt).toBeNull();
    expect(fetched!.timeToEngageMs).toBeNull();
    expect(fetched!.responseQuality).toBeNull();
    expect(typeof fetched!.createdAt).toBe("number");
  });

  it("reflects engaged=true after markEngaged", () => {
    const now = Date.now();
    const created = seedOutcome(store, { sentAt: now - 1000, senderId: "user-mark" });
    store.markEngaged("user-mark", now, "positive");

    const fetched = store.getOutcome(created.id);
    expect(fetched!.engaged).toBe(true);
    expect(fetched!.responseQuality).toBe("positive");
    expect(fetched!.timeToEngageMs).toBeGreaterThanOrEqual(0);
  });

  it("returns distinct outcomes for different ids", () => {
    const a = seedOutcome(store, { category: "news", senderId: "userA" });
    const b = seedOutcome(store, { category: "goal", senderId: "userB" });

    expect(store.getOutcome(a.id)!.category).toBe("news");
    expect(store.getOutcome(b.id)!.category).toBe("goal");
  });
});

// ── getCategoryRates ────────────────────────────────────────────────────────

describe("OutcomesStore.getCategoryRates()", () => {
  let store: OutcomesStore;

  beforeEach(() => {
    store = new OutcomesStore(makeRealVaultDb());
  });

  it("returns empty array when no outcomes exist", () => {
    expect(store.getCategoryRates("nobody")).toEqual([]);
  });

  it("returns empty array when all outcomes are outside the time window", () => {
    // seed an outcome 60 days old
    const oldSentAt = Date.now() - 60 * 86_400_000;
    seedOutcome(store, { senderId: "user-old", sentAt: oldSentAt });
    expect(store.getCategoryRates("user-old", 30)).toEqual([]);
  });

  it("returns one CategoryRate per category", () => {
    seedOutcome(store, { senderId: "userA", category: "goal" });
    seedOutcome(store, { senderId: "userA", category: "goal" });
    seedOutcome(store, { senderId: "userA", category: "task" });

    const rates = store.getCategoryRates("userA");
    expect(rates).toHaveLength(2);

    const goal = rates.find((r) => r.category === "goal")!;
    expect(goal.count).toBe(2);
    expect(goal.responded).toBe(0);
    expect(goal.rate).toBe(0);
    expect(goal.avgResponseMs).toBeNull();

    const task = rates.find((r) => r.category === "task")!;
    expect(task.count).toBe(1);
  });

  it("calculates correct rate when some outcomes are engaged", () => {
    const now = Date.now();
    seedOutcome(store, { senderId: "userB", category: "goal", sentAt: now - 5000 });
    seedOutcome(store, { senderId: "userB", category: "goal", sentAt: now - 3000 });
    // engage the most-recent one
    store.markEngaged("userB", now, "positive");

    const rates = store.getCategoryRates("userB");
    const goal = rates.find((r) => r.category === "goal")!;
    expect(goal.count).toBe(2);
    expect(goal.responded).toBe(1);
    expect(goal.rate).toBeCloseTo(0.5, 5);
    expect(goal.avgResponseMs).toBeGreaterThanOrEqual(0);
  });

  it("does not mix outcomes from different senders", () => {
    seedOutcome(store, { senderId: "userC", category: "goal" });
    seedOutcome(store, { senderId: "userD", category: "task" });

    const ratesC = store.getCategoryRates("userC");
    expect(ratesC.every((r) => r.category === "goal")).toBe(true);

    const ratesD = store.getCategoryRates("userD");
    expect(ratesD.every((r) => r.category === "task")).toBe(true);
  });

  it("rate is 0 when responded is 0 (avoids division by zero)", () => {
    seedOutcome(store, { senderId: "userE", category: "news" });
    const rates = store.getCategoryRates("userE");
    expect(rates[0]!.rate).toBe(0);
  });
});

// ── getTimingPatterns ───────────────────────────────────────────────────────

describe("OutcomesStore.getTimingPatterns()", () => {
  let store: OutcomesStore;

  beforeEach(() => {
    store = new OutcomesStore(makeRealVaultDb());
  });

  it("returns empty pattern when no outcomes exist", () => {
    const result = store.getTimingPatterns("nobody");
    expect(result.bestDays).toEqual([]);
    expect(result.bestHours).toEqual([]);
    expect(result.worstDays).toEqual([]);
    expect(result.worstHours).toEqual([]);
  });

  it("returns empty pattern when outcomes are outside the window", () => {
    const old = Date.now() - 60 * 86_400_000;
    seedOutcome(store, { senderId: "user-old2", sentAt: old, dayOfWeek: 2, hourOfDay: 9 });
    seedOutcome(store, { senderId: "user-old2", sentAt: old, dayOfWeek: 2, hourOfDay: 9 });
    const result = store.getTimingPatterns("user-old2", 30);
    expect(result.bestDays).toEqual([]);
  });

  it("ignores slots with fewer than 2 outcomes (HAVING total >= 2)", () => {
    // Only 1 outcome at day=1, hour=10 → should not appear
    seedOutcome(store, { senderId: "user-f", dayOfWeek: 1, hourOfDay: 10 });
    const result = store.getTimingPatterns("user-f");
    expect(result.bestDays).toEqual([]);
    expect(result.worstDays).toEqual([]);
  });

  it("identifies bestDays and bestHours when rate >= 0.5", () => {
    const now = Date.now();
    // Two outcomes at day=2 hour=8, both engaged → rate=1.0 → best
    seedOutcome(store, { senderId: "user-g", dayOfWeek: 2, hourOfDay: 8, sentAt: now - 10000 });
    const second = seedOutcome(store, { senderId: "user-g", dayOfWeek: 2, hourOfDay: 8, sentAt: now - 5000 });
    store.markEngaged("user-g", now - 9000, "positive"); // engage first
    // need to engage second — mark again after re-seeding time gap
    store.markEngaged("user-g", now, "positive"); // engage second

    const result = store.getTimingPatterns("user-g");
    expect(result.bestDays).toContain(2);
    expect(result.bestHours).toContain(8);
  });

  it("identifies worstDays and worstHours when rate < 0.2", () => {
    const now = Date.now();
    // Two outcomes at day=5 hour=23, neither engaged → rate=0 → worst
    seedOutcome(store, { senderId: "user-h", dayOfWeek: 5, hourOfDay: 23, sentAt: now - 10000 });
    seedOutcome(store, { senderId: "user-h", dayOfWeek: 5, hourOfDay: 23, sentAt: now - 5000 });

    const result = store.getTimingPatterns("user-h");
    expect(result.worstDays).toContain(5);
    expect(result.worstHours).toContain(23);
  });

  it("does not duplicate days/hours in best/worst lists", () => {
    const now = Date.now();
    // Three outcomes at same day=3 hour=12, none engaged
    seedOutcome(store, { senderId: "user-i", dayOfWeek: 3, hourOfDay: 12, sentAt: now - 15000 });
    seedOutcome(store, { senderId: "user-i", dayOfWeek: 3, hourOfDay: 12, sentAt: now - 10000 });
    seedOutcome(store, { senderId: "user-i", dayOfWeek: 3, hourOfDay: 12, sentAt: now - 5000 });

    const result = store.getTimingPatterns("user-i");
    const uniqueWorstDays = new Set(result.worstDays);
    expect(uniqueWorstDays.size).toBe(result.worstDays.length);
    const uniqueWorstHours = new Set(result.worstHours);
    expect(uniqueWorstHours.size).toBe(result.worstHours.length);
  });

  it("does not mix patterns from different senders", () => {
    const now = Date.now();
    // sender-X at day=1, sender-Y at day=6 — both worst (no engagement)
    seedOutcome(store, { senderId: "sender-X", dayOfWeek: 1, hourOfDay: 1, sentAt: now - 10000 });
    seedOutcome(store, { senderId: "sender-X", dayOfWeek: 1, hourOfDay: 1, sentAt: now - 5000 });
    seedOutcome(store, { senderId: "sender-Y", dayOfWeek: 6, hourOfDay: 22, sentAt: now - 10000 });
    seedOutcome(store, { senderId: "sender-Y", dayOfWeek: 6, hourOfDay: 22, sentAt: now - 5000 });

    const patX = store.getTimingPatterns("sender-X");
    const patY = store.getTimingPatterns("sender-Y");
    expect(patX.worstDays).toContain(1);
    expect(patX.worstDays).not.toContain(6);
    expect(patY.worstDays).toContain(6);
    expect(patY.worstDays).not.toContain(1);
  });
});
