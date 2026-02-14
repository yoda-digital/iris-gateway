import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";

describe("HeartbeatStore", () => {
  let dir: string;
  let db: VaultDB;
  let store: HeartbeatStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-heartbeat-"));
    db = new VaultDB(dir);
    store = new HeartbeatStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("logs a health check result", () => {
    store.logCheck({
      component: "database",
      status: "healthy",
      latencyMs: 12,
      details: "all good",
    });

    const logs = store.getRecentLogs("database", 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].component).toBe("database");
    expect(logs[0].status).toBe("healthy");
    expect(logs[0].latencyMs).toBe(12);
    expect(logs[0].details).toBe("all good");
    expect(logs[0].checkedAt).toBeGreaterThan(0);
  });

  it("logs a healing action", () => {
    store.logAction({
      component: "cache",
      action: "restart",
      success: true,
    });

    const actions = store.getRecentActions("cache", 10);
    expect(actions).toHaveLength(1);
    expect(actions[0].component).toBe("cache");
    expect(actions[0].action).toBe("restart");
    expect(actions[0].success).toBe(true);
    expect(actions[0].error).toBeNull();
    expect(actions[0].executedAt).toBeGreaterThan(0);
  });

  it("purges old logs", () => {
    store.logCheck({
      component: "database",
      status: "healthy",
      latencyMs: 5,
    });

    const purged = store.purgeOlderThan(0);
    expect(purged).toBeGreaterThan(0);

    const logs = store.getRecentLogs("database", 10);
    expect(logs).toHaveLength(0);
  });

  it("gets latest status per component", () => {
    store.logCheck({ component: "database", status: "healthy", latencyMs: 10 });
    store.logCheck({ component: "database", status: "degraded", latencyMs: 200 });
    store.logCheck({ component: "cache", status: "down", latencyMs: 5000 });
    store.logCheck({ component: "cache", status: "recovering", latencyMs: 100 });

    const statusMap = store.getLatestStatus();
    expect(statusMap.get("database")).toBe("degraded");
    expect(statusMap.get("cache")).toBe("recovering");
    expect(statusMap.size).toBe(2);
  });
});
