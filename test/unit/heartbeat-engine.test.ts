import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";
import { HeartbeatEngine } from "../../src/heartbeat/engine.js";
import type {
  HeartbeatConfig,
  HealthChecker,
  HealthStatus,
} from "../../src/heartbeat/types.js";
import type { Logger } from "../../src/logging/logger.js";

function fakeChecker(
  name: string,
  status: HealthStatus = "healthy",
): HealthChecker {
  return {
    name,
    check: vi.fn().mockResolvedValue({ component: name, status, latencyMs: 5 }),
    heal: vi.fn().mockResolvedValue(true),
  };
}

function makeConfig(overrides?: Partial<HeartbeatConfig>): HeartbeatConfig {
  return {
    enabled: true,
    intervals: { healthy: 60_000, degraded: 10_000, critical: 2_000 },
    selfHeal: { enabled: true, maxAttempts: 3, backoffTicks: 3 },
    activity: { enabled: false, dormancyThresholdMs: 3_600_000 },
    logRetentionDays: 7,
    ...overrides,
  };
}

const fakeLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: "info",
} as unknown as Logger;

describe("HeartbeatEngine", () => {
  let dir: string;
  let db: VaultDB;
  let store: HeartbeatStore;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), "iris-hb-engine-"));
    db = new VaultDB(dir);
    store = new HeartbeatStore(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts and stops cleanly", () => {
    const engine = new HeartbeatEngine({
      store,
      checkers: [fakeChecker("db")],
      logger: fakeLogger,
      config: makeConfig(),
    });

    engine.start();
    engine.stop();
  });

  it("runs checkers on tick and logs results", async () => {
    const checker = fakeChecker("database");
    const engine = new HeartbeatEngine({
      store,
      checkers: [checker],
      logger: fakeLogger,
      config: makeConfig(),
    });

    await engine.tick();

    expect(checker.check).toHaveBeenCalledOnce();

    const logs = store.getRecentLogs("database", 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("healthy");
  });

  it("triggers self-heal when component is down", async () => {
    const checker = fakeChecker("cache", "down");
    const engine = new HeartbeatEngine({
      store,
      checkers: [checker],
      logger: fakeLogger,
      config: makeConfig(),
    });

    await engine.tick();

    expect(checker.heal).toHaveBeenCalledOnce();

    const actions = store.getRecentActions("cache", 10);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("self-heal");
    expect(actions[0].success).toBe(true);
  });

  it("stops healing after maxAttempts", async () => {
    const checker: HealthChecker = {
      name: "failing",
      check: vi
        .fn()
        .mockResolvedValue({ component: "failing", status: "down", latencyMs: 5 }),
      heal: vi.fn().mockResolvedValue(false),
    };

    const engine = new HeartbeatEngine({
      store,
      checkers: [checker],
      logger: fakeLogger,
      config: makeConfig({ selfHeal: { enabled: true, maxAttempts: 3, backoffTicks: 3 } }),
    });

    await engine.tick();
    vi.advanceTimersByTime(60_000);
    await engine.tick();
    vi.advanceTimersByTime(60_000);
    await engine.tick();
    vi.advanceTimersByTime(60_000);
    await engine.tick();

    expect(checker.heal).toHaveBeenCalledTimes(3);
  });

  it("getStatus returns current component states", async () => {
    const c1 = fakeChecker("database");
    const c2 = fakeChecker("cache", "degraded");
    const engine = new HeartbeatEngine({
      store,
      checkers: [c1, c2],
      logger: fakeLogger,
      config: makeConfig(),
    });

    await engine.tick();

    const statuses = engine.getStatus();
    expect(statuses).toHaveLength(2);

    const dbStatus = statuses.find((s) => s.component === "database");
    const cacheStatus = statuses.find((s) => s.component === "cache");
    expect(dbStatus?.status).toBe("healthy");
    expect(dbStatus?.agentId).toBe("default");
    expect(cacheStatus?.status).toBe("recovering");
    expect(cacheStatus?.agentId).toBe("default");
  });
});
