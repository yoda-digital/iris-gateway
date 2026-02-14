import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";
import { HeartbeatEngine } from "../../src/heartbeat/engine.js";
import type { HeartbeatConfig, HealthChecker, HealthStatus } from "../../src/heartbeat/types.js";
import type { Logger } from "../../src/logging/logger.js";

function fakeChecker(name: string, status: HealthStatus = "healthy"): HealthChecker {
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
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child: vi.fn().mockReturnThis(), level: "info",
} as unknown as Logger;

describe("HeartbeatEngine V2", () => {
  let dir: string;
  let db: VaultDB;
  let store: HeartbeatStore;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), "iris-hb-v2-"));
    db = new VaultDB(dir);
    store = new HeartbeatStore(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("getStatus includes agentId in results", async () => {
    const engine = new HeartbeatEngine({
      store, checkers: [fakeChecker("bridge")], logger: fakeLogger, config: makeConfig(),
    });
    await engine.tick();
    const statuses = engine.getStatus();
    expect(statuses[0]).toHaveProperty("agentId", "default");
  });

  it("multi-agent: each agent runs independently", async () => {
    const config = makeConfig({
      agents: [
        { agentId: "production", intervals: { healthy: 30_000 } },
        { agentId: "staging", intervals: { healthy: 120_000 } },
      ],
    });
    const engine = new HeartbeatEngine({
      store, checkers: [fakeChecker("bridge")], logger: fakeLogger, config,
    });
    await engine.tick();
    const statuses = engine.getStatus();
    const agentIds = statuses.map((s) => s.agentId);
    expect(agentIds).toContain("production");
    expect(agentIds).toContain("staging");
  });

  it("active hours: skips tick when outside window", async () => {
    vi.setSystemTime(new Date("2026-06-15T04:00:00Z")); // 07:00 Chisinau
    const checker = fakeChecker("bridge");
    const config = makeConfig({
      activeHours: { start: "09:00", end: "22:00", timezone: "Europe/Chisinau" },
    });
    const engine = new HeartbeatEngine({
      store, checkers: [checker], logger: fakeLogger, config,
    });
    await engine.tick();
    expect(checker.check).not.toHaveBeenCalled();
  });

  it("backward compat: works with no v2 config", async () => {
    const engine = new HeartbeatEngine({
      store, checkers: [fakeChecker("bridge")], logger: fakeLogger, config: makeConfig(),
    });
    engine.start();
    await engine.tick();
    const statuses = engine.getStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].agentId).toBe("default");
    engine.stop();
  });
});
