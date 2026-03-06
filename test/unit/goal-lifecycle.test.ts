import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoalLifecycle } from "../../src/intelligence/goals/lifecycle.js";
import type { IntelligenceStore } from "../../src/intelligence/store.js";
import type { IntelligenceBus } from "../../src/intelligence/bus.js";
import type { Logger } from "../../src/logging/logger.js";
import type { Goal, GoalStatus } from "../../src/intelligence/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g-1",
    senderId: "user-1",
    channelId: "chan-1",
    description: "Finish project X",
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    priority: 50,
    progressNote: undefined,
    nextAction: undefined,
    nextActionDue: undefined,
    successCriteria: undefined,
    arcId: undefined,
    ...overrides,
  };
}

function makeStore(initial?: Partial<Goal>): IntelligenceStore {
  let stored = makeGoal(initial);
  return {
    createGoal: vi.fn((params) => {
      stored = makeGoal({ ...params, id: "g-1", createdAt: Date.now(), updatedAt: Date.now(), priority: params.priority ?? 50 });
      return stored;
    }),
    getGoal: vi.fn(() => stored),
    updateGoal: vi.fn((id, patch) => {
      stored = { ...stored, ...patch, updatedAt: Date.now() };
      return stored;
    }),
    getDueGoals: vi.fn(() => [stored]),
    getStaleGoals: vi.fn(() => [stored]),
    getActiveGoals: vi.fn((senderId) => senderId === stored.senderId && stored.status === "active" ? [stored] : []),
    getPausedGoals: vi.fn((senderId) => senderId === stored.senderId && stored.status === "paused" ? [stored] : []),
  } as unknown as IntelligenceStore;
}

function makeBus(): IntelligenceBus {
  return { emit: vi.fn() } as unknown as IntelligenceBus;
}

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GoalLifecycle", () => {
  // ── create() ──────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("creates a goal and emits goal_created bus event", () => {
      const store = makeStore();
      const bus = makeBus();
      const lc = new GoalLifecycle(store, bus, makeLogger());

      const goal = lc.create({ senderId: "u1", channelId: "c1", description: "Launch feature" });

      expect(store.createGoal).toHaveBeenCalledWith(expect.objectContaining({ description: "Launch feature" }));
      expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "goal_created", senderId: "u1" }));
      expect(goal.description).toBe("Launch feature");
    });

    it("forwards all optional fields to store", () => {
      const store = makeStore();
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      lc.create({
        senderId: "u1", channelId: "c1", description: "Ship v2",
        arcId: "arc-1", successCriteria: "10k users", nextAction: "write tests",
        nextActionDue: Date.now() + 86_400_000, priority: 90,
      });

      expect(store.createGoal).toHaveBeenCalledWith(expect.objectContaining({
        arcId: "arc-1", successCriteria: "10k users", priority: 90,
      }));
    });
  });

  // ── transition() — valid paths ─────────────────────────────────────────────

  describe("transition() — valid state machine paths", () => {
    const validPaths: [GoalStatus, GoalStatus][] = [
      ["active", "paused"],
      ["active", "completed"],
      ["active", "abandoned"],
      ["paused", "active"],
      ["paused", "abandoned"],
    ];

    for (const [from, to] of validPaths) {
      it(`allows ${from} → ${to}`, () => {
        const store = makeStore({ status: from });
        const lc = new GoalLifecycle(store, makeBus(), makeLogger());

        const result = lc.transition("g-1", to);

        expect(result).not.toBeNull();
        expect(store.updateGoal).toHaveBeenCalledWith("g-1", { status: to });
      });
    }
  });

  // ── transition() — invalid / terminal states ───────────────────────────────

  describe("transition() — invalid / terminal state enforcement", () => {
    const blockedPaths: [GoalStatus, GoalStatus][] = [
      ["completed", "active"],
      ["completed", "paused"],
      ["completed", "abandoned"],
      ["abandoned", "active"],
      ["abandoned", "paused"],
      ["abandoned", "completed"],
      ["active", "active"],    // self-transition
      ["paused", "completed"], // paused cannot complete directly
    ];

    for (const [from, to] of blockedPaths) {
      it(`rejects ${from} → ${to} (returns null, logs warn)`, () => {
        const store = makeStore({ status: from });
        const logger = makeLogger();
        const lc = new GoalLifecycle(store, makeBus(), logger);

        const result = lc.transition("g-1", to);

        expect(result).toBeNull();
        expect(store.updateGoal).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ from, to }),
          expect.any(String),
        );
      });
    }

    it("returns null for unknown goal id", () => {
      const store = makeStore();
      (store.getGoal as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      expect(lc.transition("nonexistent", "completed")).toBeNull();
    });
  });

  // ── scanDueGoals() ────────────────────────────────────────────────────────

  describe("scanDueGoals()", () => {
    it("returns due goals and emits goal_due for each", () => {
      const store = makeStore({ id: "g-due" });
      const bus = makeBus();
      const lc = new GoalLifecycle(store, bus, makeLogger());

      const results = lc.scanDueGoals();

      expect(results).toHaveLength(1);
      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "goal_due", goalId: "g-due" }),
      );
    });

    it("returns empty array and emits no events when no goals are due", () => {
      const store = makeStore();
      (store.getDueGoals as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const bus = makeBus();
      const lc = new GoalLifecycle(store, bus, makeLogger());

      const results = lc.scanDueGoals();

      expect(results).toHaveLength(0);
      expect(bus.emit).not.toHaveBeenCalled();
    });
  });

  // ── scanStaleGoals() ──────────────────────────────────────────────────────

  describe("scanStaleGoals()", () => {
    it("delegates to store.getStaleGoals and returns result", () => {
      const store = makeStore({ id: "g-stale" });
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      const results = lc.scanStaleGoals();

      expect(store.getStaleGoals).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("g-stale");
    });
  });

  // ── listGoals() ───────────────────────────────────────────────────────────

  describe("listGoals()", () => {
    it("returns active and paused goals grouped by status", () => {
      const store = makeStore({ status: "active", senderId: "u1" });
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      const { active, paused } = lc.listGoals("u1");

      expect(active).toHaveLength(1);
      expect(paused).toHaveLength(0);
    });
  });

  // ── getGoalContext() ──────────────────────────────────────────────────────

  describe("getGoalContext()", () => {
    it("returns null when no active or paused goals", () => {
      const store = makeStore();
      (store.getActiveGoals as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (store.getPausedGoals as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      expect(lc.getGoalContext("u1")).toBeNull();
    });

    it("includes HIGH priority label for goals with priority > 70", () => {
      const store = makeStore({ status: "active", senderId: "u1", priority: 90 });
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      const ctx = lc.getGoalContext("u1");
      expect(ctx).toContain("[HIGH]");
    });

    it("includes low priority label for goals with priority < 30", () => {
      const store = makeStore({ status: "active", senderId: "u1", priority: 20 });
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      const ctx = lc.getGoalContext("u1");
      expect(ctx).toContain("[low]");
    });

    it("includes language directive when userLanguage is provided", () => {
      const store = makeStore({ status: "active", senderId: "u1" });
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      const ctx = lc.getGoalContext("u1", "ro");
      expect(ctx).toContain("[LANGUAGE:");
      expect(ctx).toContain("ro");
    });

    it("includes overdue label for past nextActionDue", () => {
      const store = makeStore({ status: "active", senderId: "u1", nextActionDue: Date.now() - 3_600_000 });
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      const ctx = lc.getGoalContext("u1");
      expect(ctx).toContain("overdue");
    });

    it("includes paused goals section when paused goals exist", () => {
      const store = makeStore({ status: "active", senderId: "u1" });
      const paused = makeGoal({ id: "g-2", status: "paused", senderId: "u1", description: "Paused goal" });
      (store.getPausedGoals as ReturnType<typeof vi.fn>).mockReturnValue([paused]);
      const lc = new GoalLifecycle(store, makeBus(), makeLogger());

      const ctx = lc.getGoalContext("u1");
      expect(ctx).toContain("Paused:");
      expect(ctx).toContain("Paused goal");
    });
  });
});
