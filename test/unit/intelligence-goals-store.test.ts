import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { GoalsStore } from "../../src/intelligence/goals/store.js";
import type { VaultDB } from "../../src/vault/db.js";

function makeVaultDB(): VaultDB {
  const db = new Database(":memory:");
  return { raw: () => db } as unknown as VaultDB;
}

describe("GoalsStore", () => {
  let store: GoalsStore;
  beforeEach(() => { store = new GoalsStore(makeVaultDB()); });

  it("createGoal returns goal with defaults", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "do thing" });
    expect(g.id).toBeTruthy();
    expect(g.status).toBe("active");
    expect(g.priority).toBe(50);
    expect(g.arcId).toBeNull();
    expect(g.successCriteria).toBeNull();
    expect(g.nextAction).toBeNull();
    expect(g.completedAt).toBeNull();
    expect(JSON.parse(g.progressNotes)).toEqual([]);
  });

  it("createGoal with full params", () => {
    const g = store.createGoal({
      senderId: "s1", channelId: "c1", description: "d",
      arcId: "arc-1", successCriteria: "done", nextAction: "step1",
      nextActionDue: 9999999, priority: 80
    });
    expect(g.arcId).toBe("arc-1");
    expect(g.successCriteria).toBe("done");
    expect(g.nextAction).toBe("step1");
    expect(g.nextActionDue).toBe(9999999);
    expect(g.priority).toBe(80);
  });

  it("getGoal returns null for unknown id", () => {
    expect(store.getGoal("ghost")).toBeNull();
  });

  it("getActiveGoals returns only active goals for sender", () => {
    store.createGoal({ senderId: "s1", channelId: "c1", description: "g1" });
    store.createGoal({ senderId: "s1", channelId: "c1", description: "g2" });
    store.createGoal({ senderId: "s2", channelId: "c1", description: "g3" });
    expect(store.getActiveGoals("s1")).toHaveLength(2);
  });

  it("getActiveGoals excludes completed goals", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g" });
    store.updateGoal(g.id, { status: "completed" });
    expect(store.getActiveGoals("s1")).toHaveLength(0);
  });

  it("getPausedGoals returns paused goals", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g" });
    store.updateGoal(g.id, { status: "paused" });
    expect(store.getPausedGoals("s1")).toHaveLength(1);
  });

  it("updateGoal adds progressNote", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g" });
    store.updateGoal(g.id, { progressNote: "step done" });
    const updated = store.getGoal(g.id)!;
    const notes = JSON.parse(updated.progressNotes);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe("step done");
  });

  it("updateGoal updates nextAction and nextActionDue", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g" });
    store.updateGoal(g.id, { nextAction: "do it", nextActionDue: 12345 });
    const updated = store.getGoal(g.id)!;
    expect(updated.nextAction).toBe("do it");
    expect(updated.nextActionDue).toBe(12345);
  });

  it("updateGoal clears nextAction with null", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g", nextAction: "x" });
    store.updateGoal(g.id, { nextAction: null });
    expect(store.getGoal(g.id)!.nextAction).toBeNull();
  });

  it("updateGoal changes priority", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g" });
    store.updateGoal(g.id, { priority: 90 });
    expect(store.getGoal(g.id)!.priority).toBe(90);
  });

  it("updateGoal status completed sets completedAt", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g" });
    store.updateGoal(g.id, { status: "completed" });
    const updated = store.getGoal(g.id)!;
    expect(updated.status).toBe("completed");
    expect(updated.completedAt).toBeGreaterThan(0);
  });

  it("updateGoal returns null for unknown id", () => {
    expect(store.updateGoal("ghost", { priority: 10 })).toBeNull();
  });

  it("getDueGoals returns goals past due date", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g", nextActionDue: Date.now() - 1000 });
    const due = store.getDueGoals();
    expect(due.some(x => x.id === g.id)).toBe(true);
  });

  it("getDueGoals excludes future goals", () => {
    store.createGoal({ senderId: "s1", channelId: "c1", description: "g", nextActionDue: Date.now() + 999999 });
    expect(store.getDueGoals()).toHaveLength(0);
  });

  it("getDueGoals excludes goals without nextActionDue", () => {
    store.createGoal({ senderId: "s1", channelId: "c1", description: "g" });
    expect(store.getDueGoals()).toHaveLength(0);
  });

  it("getStaleGoals returns goals not updated for 30+ days", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "old" });
    const db = (store as any).db as Database.Database;
    db.prepare("UPDATE goals SET updated_at = ? WHERE id = ?").run(Date.now() - 31 * 86_400_000, g.id);
    expect(store.getStaleGoals().some(x => x.id === g.id)).toBe(true);
  });

  it("getStaleGoals excludes recent goals", () => {
    store.createGoal({ senderId: "s1", channelId: "c1", description: "fresh" });
    expect(store.getStaleGoals()).toHaveLength(0);
  });

  // Additional coverage from @claude review on PR #118
  it("updateGoal status=abandoned does not set completedAt", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g" });
    store.updateGoal(g.id, { status: "abandoned" as any });
    expect(store.getGoal(g.id)!.completedAt).toBeNull();
  });

  it("getDueGoals excludes paused goals even if past due", () => {
    const g = store.createGoal({ senderId: "s1", channelId: "c1", description: "g", nextActionDue: Date.now() - 1000 });
    store.updateGoal(g.id, { status: "paused" });
    expect(store.getDueGoals().find(x => x.id === g.id)).toBeUndefined();
  });


});