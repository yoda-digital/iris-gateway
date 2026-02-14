import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";

describe("HeartbeatStore dedup", () => {
  let dir: string;
  let db: VaultDB;
  let store: HeartbeatStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-hb-dedup-"));
    db = new VaultDB(dir);
    store = new HeartbeatStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("isDuplicate returns false when no previous alert", () => {
    expect(store.isDuplicate("bridge", "default", "Bridge is down", 86_400_000)).toBe(false);
  });

  it("isDuplicate returns true for same alert within window", () => {
    store.recordAlert("bridge", "default", "Bridge is down");
    expect(store.isDuplicate("bridge", "default", "Bridge is down", 86_400_000)).toBe(true);
  });

  it("isDuplicate returns false for different text", () => {
    store.recordAlert("bridge", "default", "Bridge is down");
    expect(store.isDuplicate("bridge", "default", "Bridge is degraded", 86_400_000)).toBe(false);
  });

  it("isDuplicate returns false after window expires", () => {
    store.recordAlert("bridge", "default", "Bridge is down");
    db.raw().prepare("UPDATE heartbeat_dedup SET last_sent_at = ?").run(Date.now() - 100_000_000);
    expect(store.isDuplicate("bridge", "default", "Bridge is down", 86_400_000)).toBe(false);
  });

  it("logCheck accepts agentId", () => {
    store.logCheck({ component: "bridge", status: "healthy", latencyMs: 5, agentId: "production" });
    const logs = store.getRecentLogs("bridge", 10);
    expect(logs).toHaveLength(1);
  });

  it("logAction accepts agentId", () => {
    store.logAction({ component: "bridge", action: "self-heal", success: true, agentId: "production" });
    const actions = store.getRecentActions("bridge", 10);
    expect(actions).toHaveLength(1);
  });
});
