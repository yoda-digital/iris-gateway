import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";
import { ActivityTracker } from "../../src/heartbeat/activity.js";

describe("ActivityTracker", () => {
  let dir: string;
  let db: VaultDB;
  let vaultStore: VaultStore;
  let tracker: ActivityTracker;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-activity-"));
    db = new VaultDB(dir);
    vaultStore = new VaultStore(db);
    tracker = new ActivityTracker(db, vaultStore);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records activity and computes message count", () => {
    vaultStore.upsertProfile({ senderId: "user1", channelId: "ch1" });

    tracker.recordMessage("user1", "ch1");
    tracker.recordMessage("user1", "ch1");
    tracker.recordMessage("user1", "ch1");

    const stats = tracker.getStats("user1", "ch1");
    expect(stats.messageCount7d).toBe(3);
  });

  it("computes dormancy risk 0 for active user", () => {
    vaultStore.upsertProfile({ senderId: "user1", channelId: "ch1" });
    tracker.recordMessage("user1", "ch1");

    const stats = tracker.getStats("user1", "ch1");
    expect(stats.dormancyRisk).toBeLessThan(0.3);
  });

  it("computes high dormancy risk for inactive user", () => {
    vaultStore.upsertProfile({ senderId: "user1", channelId: "ch1" });

    db.raw()
      .prepare("UPDATE profiles SET last_seen = ? WHERE sender_id = ?")
      .run(Date.now() - 14 * 86_400_000, "user1");

    const stats = tracker.getStats("user1", "ch1");
    expect(stats.dormancyRisk).toBeGreaterThan(0.7);
  });
});
