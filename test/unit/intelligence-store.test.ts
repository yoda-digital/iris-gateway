/**
 * test/unit/intelligence-store.test.ts
 *
 * Covers IntelligenceStore facade delegation methods (issue #196).
 * The facade delegates to InferenceStore, OutcomesStore, ArcsStore, GoalsStore.
 * These domain stores are individually tested; this file ensures the facade
 * layer itself is exercised so delegation bugs are caught.
 */

import { describe, it, expect, vi } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { IntelligenceStore } from "../../src/intelligence/store.js";
import type { VaultDB } from "../../src/vault/db.js";

vi.mock("../../src/gateway/metrics.js", () => ({
  metrics: {
    outcomesLogged: { inc: vi.fn() },
    arcsDetected: { inc: vi.fn() },
    intentsTriggered: { inc: vi.fn() },
    inferenceRuns: { inc: vi.fn() },
    goalsCreated: { inc: vi.fn() },
  },
}));

function makeDb(): VaultDB {
  const raw = new BetterSqlite3(":memory:");
  return { raw: () => raw } as unknown as VaultDB;
}

describe("IntelligenceStore — Inference delegation", () => {
  it("writeDerivedSignal + getDerivedSignal round-trip", () => {
    const store = new IntelligenceStore(makeDb());
    const sig = store.writeDerivedSignal({
      senderId: "u1",
      signalType: "engagement",
      value: "high",
      confidence: 0.9,
      sourceRuleId: "rule-1",
    });
    expect(sig.id).toBeTruthy();
    expect(sig.signalType).toBe("engagement");

    const fetched = store.getDerivedSignal(sig.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.value).toBe("high");
  });

  it("getDerivedSignal returns null for unknown id", () => {
    const store = new IntelligenceStore(makeDb());
    expect(store.getDerivedSignal("nonexistent")).toBeNull();
  });

  it("getDerivedSignals returns list filtered by senderId", () => {
    const store = new IntelligenceStore(makeDb());
    store.writeDerivedSignal({ senderId: "u1", signalType: "mood", value: "happy", confidence: 0.8, sourceRuleId: "r1" });
    store.writeDerivedSignal({ senderId: "u2", signalType: "mood", value: "sad", confidence: 0.5, sourceRuleId: "r1" });
    const results = store.getDerivedSignals("u1");
    expect(results).toHaveLength(1);
    expect(results[0].senderId).toBe("u1");
  });

  it("getDerivedSignals filters by signalType", () => {
    const store = new IntelligenceStore(makeDb());
    store.writeDerivedSignal({ senderId: "u1", signalType: "mood", value: "ok", confidence: 0.5, sourceRuleId: "r1" });
    store.writeDerivedSignal({ senderId: "u1", signalType: "intent", value: "buy", confidence: 0.7, sourceRuleId: "r2" });
    const mood = store.getDerivedSignals("u1", "mood");
    expect(mood).toHaveLength(1);
    expect(mood[0].signalType).toBe("mood");
  });

  it("logInference + getLastInferenceRun", () => {
    const store = new IntelligenceStore(makeDb());
    const ts = Date.now();
    store.logInference({ ruleId: "rule-x", senderId: "u1", executedAt: ts, result: "produced", details: null });
    const last = store.getLastInferenceRun("rule-x", "u1");
    expect(last).toBe(ts);
  });

  it("getLastInferenceRun returns null when no run exists", () => {
    const store = new IntelligenceStore(makeDb());
    expect(store.getLastInferenceRun("rule-none", "u-nobody")).toBeNull();
  });
});

describe("IntelligenceStore — Outcomes delegation", () => {
  it("recordOutcome + getOutcome round-trip", () => {
    const store = new IntelligenceStore(makeDb());
    const now = Date.now();
    const outcome = store.recordOutcome({
      intentId: "intent-1",
      senderId: "u1",
      channelId: "telegram",
      category: "news",
      sentAt: now,
      dayOfWeek: 1,
      hourOfDay: 10,
    });
    expect(outcome.id).toBeTruthy();
    expect(outcome.category).toBe("news");

    const fetched = store.getOutcome(outcome.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.intentId).toBe("intent-1");
  });

  it("getOutcome returns null for unknown id", () => {
    const store = new IntelligenceStore(makeDb());
    expect(store.getOutcome("unknown")).toBeNull();
  });

  it("markEngaged returns false when no unengaged outcome", () => {
    const store = new IntelligenceStore(makeDb());
    expect(store.markEngaged("u-nobody", Date.now(), "positive")).toBe(false);
  });

  it("getCategoryRates returns empty array on empty DB", () => {
    const store = new IntelligenceStore(makeDb());
    expect(store.getCategoryRates("u1")).toEqual([]);
  });

  it("getTimingPatterns returns empty arrays on empty DB", () => {
    const store = new IntelligenceStore(makeDb());
    const p = store.getTimingPatterns("u1");
    expect(p.bestDays).toEqual([]);
    expect(p.bestHours).toEqual([]);
    expect(p.worstDays).toEqual([]);
    expect(p.worstHours).toEqual([]);
  });
});

describe("IntelligenceStore — Arcs delegation", () => {
  it("createArc + getArc round-trip", () => {
    const store = new IntelligenceStore(makeDb());
    const arc = store.createArc({
      senderId: "u1",
      channelId: "telegram",
      title: "Weekend plans",
      seedEntryId: "msg-1",
    });
    expect(arc.id).toBeTruthy();
    expect(arc.title).toBe("Weekend plans");

    const fetched = store.getArc(arc.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.senderId).toBe("u1");
  });

  it("getArc returns null for unknown id", () => {
    const store = new IntelligenceStore(makeDb());
    expect(store.getArc("nope")).toBeNull();
  });

  it("addArcEntry + getArcEntries", () => {
    const store = new IntelligenceStore(makeDb());
    const arc = store.createArc({ senderId: "u1", title: "Test" });
    const entry = store.addArcEntry({ arcId: arc.id, content: "some arc content" });
    expect(entry.arcId).toBe(arc.id);

    const entries = store.getArcEntries(arc.id);
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it("getActiveArcs returns arcs for sender", () => {
    const store = new IntelligenceStore(makeDb());
    store.createArc({ senderId: "u1", title: "Arc A" });
    const active = store.getActiveArcs("u1");
    expect(active.length).toBeGreaterThanOrEqual(1);
  });

  it("getArcsBySender returns all arcs for sender", () => {
    const store = new IntelligenceStore(makeDb());
    store.createArc({ senderId: "u1", title: "Arc A" });
    store.createArc({ senderId: "u1", title: "Arc B" });
    const all = store.getArcsBySender("u1");
    expect(all.length).toBe(2);
  });

  it("updateArcTitle changes the title", () => {
    const store = new IntelligenceStore(makeDb());
    const arc = store.createArc({ senderId: "u1", title: "Old" });
    store.updateArcTitle(arc.id, "New Title");
    const fetched = store.getArc(arc.id);
    expect(fetched!.title).toBe("New Title");
  });

  it("updateArcStatus changes the status", () => {
    const store = new IntelligenceStore(makeDb());
    const arc = store.createArc({ senderId: "u1", title: "Arc" });
    store.updateArcStatus(arc.id, "resolved");
    const fetched = store.getArc(arc.id);
    expect(fetched!.status).toBe("resolved");
  });

  it("getStaleArcs returns empty on fresh arcs", () => {
    const store = new IntelligenceStore(makeDb());
    store.createArc({ senderId: "u1", title: "Fresh" });
    const stale = store.getStaleArcs(30);
    expect(stale).toEqual([]);
  });

  it("findArcByKeywords returns matching arc (2+ keyword overlap required)", () => {
    const store = new IntelligenceStore(makeDb());
    store.createArc({ senderId: "u1", title: "vacation beach plans" });
    const found = store.findArcByKeywords("u1", ["vacation", "beach"]);
    expect(found).not.toBeNull();
  });

  it("findArcByKeywords returns null when only 1 keyword matches", () => {
    const store = new IntelligenceStore(makeDb());
    store.createArc({ senderId: "u1", title: "vacation plans" });
    const found = store.findArcByKeywords("u1", ["vacation", "nonexistent-xyz"]);
    expect(found).toBeNull();
  });
});

describe("IntelligenceStore — Goals delegation", () => {
  it("createGoal + getGoal round-trip", () => {
    const store = new IntelligenceStore(makeDb());
    const goal = store.createGoal({
      senderId: "u1",
      channelId: "telegram",
      description: "Read a book per month",
    });
    expect(goal.id).toBeTruthy();
    expect(goal.description).toBe("Read a book per month");

    const fetched = store.getGoal(goal.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.description).toBe("Read a book per month");
  });

  it("getGoal returns null for unknown id", () => {
    const store = new IntelligenceStore(makeDb());
    expect(store.getGoal("unknown")).toBeNull();
  });

  it("getActiveGoals returns created goals", () => {
    const store = new IntelligenceStore(makeDb());
    store.createGoal({ senderId: "u1", channelId: "telegram", description: "Goal A" });
    const active = store.getActiveGoals("u1");
    expect(active.length).toBeGreaterThanOrEqual(1);
  });

  it("getPausedGoals returns empty initially", () => {
    const store = new IntelligenceStore(makeDb());
    store.createGoal({ senderId: "u1", channelId: "telegram", description: "Goal A" });
    const paused = store.getPausedGoals("u1");
    expect(paused).toEqual([]);
  });

  it("getDueGoals returns empty on fresh goals without deadline", () => {
    const store = new IntelligenceStore(makeDb());
    store.createGoal({ senderId: "u1", channelId: "telegram", description: "No deadline" });
    const due = store.getDueGoals();
    expect(due).toEqual([]);
  });

  it("updateGoal changes goal status", () => {
    const store = new IntelligenceStore(makeDb());
    const goal = store.createGoal({ senderId: "u1", channelId: "telegram", description: "Original" });
    const updated = store.updateGoal(goal.id, { status: "paused" });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("paused");
  });

  it("updateGoal returns null for unknown id", () => {
    const store = new IntelligenceStore(makeDb());
    const result = store.updateGoal("unknown-id", { status: "paused" });
    expect(result).toBeNull();
  });

  it("getStaleGoals returns empty on recently created goals", () => {
    const store = new IntelligenceStore(makeDb());
    store.createGoal({ senderId: "u1", channelId: "telegram", description: "Fresh goal" });
    const stale = store.getStaleGoals(30);
    expect(stale).toEqual([]);
  });
});
