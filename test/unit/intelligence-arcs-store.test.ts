import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ArcsStore } from "../../src/intelligence/arcs/store.js";
import type { VaultDB } from "../../src/vault/db.js";

function makeVaultDB(): VaultDB {
  const db = new Database(":memory:");
  return { raw: () => db } as unknown as VaultDB;
}

describe("ArcsStore", () => {
  let store: ArcsStore;
  beforeEach(() => { store = new ArcsStore(makeVaultDB()); });

  it("createArc returns arc with defaults", () => {
    const arc = store.createArc({ senderId: "s1", title: "Test Arc" });
    expect(arc.id).toBeTruthy();
    expect(arc.senderId).toBe("s1");
    expect(arc.title).toBe("Test Arc");
    expect(arc.status).toBe("active");
    expect(arc.summary).toBeNull();
    expect(arc.staleDays).toBe(14);
  });

  it("createArc with custom staleDays and summary", () => {
    const arc = store.createArc({ senderId: "s1", title: "T", summary: "sum", staleDays: 7 });
    expect(arc.summary).toBe("sum");
    expect(arc.staleDays).toBe(7);
  });

  it("getArc returns null for unknown id", () => {
    expect(store.getArc("nonexistent")).toBeNull();
  });

  it("getArc returns arc by id", () => {
    const arc = store.createArc({ senderId: "s1", title: "T" });
    expect(store.getArc(arc.id)?.id).toBe(arc.id);
  });

  it("getActiveArcs returns only active arcs for sender", () => {
    store.createArc({ senderId: "s1", title: "A1" });
    store.createArc({ senderId: "s1", title: "A2" });
    store.createArc({ senderId: "s2", title: "B1" });
    const arcs = store.getActiveArcs("s1");
    expect(arcs).toHaveLength(2);
    expect(arcs.every(a => a.senderId === "s1")).toBe(true);
  });

  it("getActiveArcs excludes resolved arcs", () => {
    const arc = store.createArc({ senderId: "s1", title: "T" });
    store.updateArcStatus(arc.id, "resolved");
    expect(store.getActiveArcs("s1")).toHaveLength(0);
  });

  it("getArcsBySender returns all statuses", () => {
    const arc = store.createArc({ senderId: "s1", title: "T" });
    store.updateArcStatus(arc.id, "resolved");
    expect(store.getArcsBySender("s1")).toHaveLength(1);
  });

  it("addArcEntry creates entry and updates arc summary", () => {
    const arc = store.createArc({ senderId: "s1", title: "T" });
    const entry = store.addArcEntry({ arcId: arc.id, content: "some content here" });
    expect(entry.id).toBeTruthy();
    expect(entry.arcId).toBe(arc.id);
    expect(entry.content).toBe("some content here");
    expect(entry.source).toBe("conversation");
    const updated = store.getArc(arc.id)!;
    expect(updated.summary).toBe("some content here");
  });

  it("addArcEntry with custom source and memoryId", () => {
    const arc = store.createArc({ senderId: "s1", title: "T" });
    const entry = store.addArcEntry({ arcId: arc.id, content: "x", source: "compaction", memoryId: "mem-1" });
    expect(entry.source).toBe("compaction");
    expect(entry.memoryId).toBe("mem-1");
  });

  it("getArcEntries returns entries in order", () => {
    const arc = store.createArc({ senderId: "s1", title: "T" });
    store.addArcEntry({ arcId: arc.id, content: "first" });
    store.addArcEntry({ arcId: arc.id, content: "second" });
    const entries = store.getArcEntries(arc.id);
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe("first");
    expect(entries[1].content).toBe("second");
  });

  it("getArcEntries returns empty for unknown arcId", () => {
    expect(store.getArcEntries("ghost")).toEqual([]);
  });

  it("updateArcTitle changes title", () => {
    const arc = store.createArc({ senderId: "s1", title: "Old" });
    store.updateArcTitle(arc.id, "New");
    expect(store.getArc(arc.id)!.title).toBe("New");
  });

  it("updateArcStatus to resolved sets resolvedAt", () => {
    const arc = store.createArc({ senderId: "s1", title: "T" });
    store.updateArcStatus(arc.id, "resolved");
    const updated = store.getArc(arc.id)!;
    expect(updated.status).toBe("resolved");
    expect(updated.resolvedAt).toBeGreaterThan(0);
  });

  it("updateArcStatus to stale does not set resolvedAt", () => {
    const arc = store.createArc({ senderId: "s1", title: "T" });
    store.updateArcStatus(arc.id, "stale");
    expect(store.getArc(arc.id)!.resolvedAt).toBeNull();
  });

  it("getStaleArcs returns arcs past stale threshold", () => {
    const arc = store.createArc({ senderId: "s1", title: "Old Arc", staleDays: 1 });
    // Manually set updated_at to 2 days ago
    const db = (store as any).db as Database.Database;
    db.prepare("UPDATE memory_arcs SET updated_at = ? WHERE id = ?").run(Date.now() - 2 * 86_400_000, arc.id);
    const stale = store.getStaleArcs();
    expect(stale.some(a => a.id === arc.id)).toBe(true);
  });

  it("getStaleArcs excludes recent arcs", () => {
    store.createArc({ senderId: "s1", title: "Fresh" });
    expect(store.getStaleArcs()).toHaveLength(0);
  });

  it("findArcByKeywords matches on 2+ title words", () => {
    store.createArc({ senderId: "s1", title: "project-budget-review" });
    const found = store.findArcByKeywords("s1", ["project", "budget"]);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("project-budget-review");
  });

  it("findArcByKeywords returns null when <2 words match", () => {
    store.createArc({ senderId: "s1", title: "project-budget-review" });
    expect(store.findArcByKeywords("s1", ["project", "xyz"])).toBeNull();
  });
});
