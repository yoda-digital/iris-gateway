import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthGate } from "../../src/intelligence/health/gate.js";

describe("HealthGate - Throttle Behavior", () => {
  let gate: HealthGate;
  let heartbeatStore: any;
  let trendDetector: any;
  let bus: any;
  let logger: any;

  beforeEach(() => {
    heartbeatStore = {
      getLatestStatus: vi.fn().mockReturnValue(new Map()),
      recordStatus: vi.fn(),
    };

    trendDetector = {
      analyzeAll: vi.fn().mockReturnValue([]),
      analyze: vi.fn(),
    };

    bus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      dispose: vi.fn(),
    };

    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    gate = new HealthGate(heartbeatStore, trendDetector, bus, logger);
  });

  it("returns normal throttle when all systems are healthy", () => {
    heartbeatStore.getLatestStatus.mockReturnValue(new Map([
      ["database", "healthy"],
      ["api", "healthy"],
    ]));
    trendDetector.analyzeAll.mockReturnValue([]);

    const result = gate.check();

    expect(result.throttle).toBe("normal");
    expect(result.reason).toContain("all_healthy");
  });

  it("reduces throttle to 'reduced' when one component is unhealthy", () => {
    heartbeatStore.getLatestStatus.mockReturnValue(new Map([
      ["database", "unhealthy"],
      ["api", "healthy"],
    ]));
    trendDetector.analyzeAll.mockReturnValue([]);

    const result = gate.check();

    expect(result.throttle).toBe("reduced");
    expect(result.reason).toContain("partially_degraded");
  });

  it("throttles to 'minimal' when 3+ components are unhealthy", () => {
    heartbeatStore.getLatestStatus.mockReturnValue(new Map([
      ["database", "unhealthy"],
      ["api", "unhealthy"],
      ["cache", "unhealthy"],
    ]));
    trendDetector.analyzeAll.mockReturnValue([]);

    const result = gate.check();

    expect(result.throttle).toBe("minimal");
    expect(result.reason).toContain("degraded");
  });

  it("pauses when critical trajectory is detected", () => {
    heartbeatStore.getLatestStatus.mockReturnValue(new Map([
      ["database", "healthy"],
    ]));
    trendDetector.analyzeAll.mockReturnValue([
      { component: "api", trend: "critical_trajectory", severity: 9 },
    ]);

    const result = gate.check();

    expect(result.throttle).toBe("paused");
    expect(result.reason).toContain("critical");
  });

  it("pauses immediately on critical component status", () => {
    heartbeatStore.getLatestStatus.mockReturnValue(new Map([
      ["api", "critical"],
    ]));
    trendDetector.analyzeAll.mockReturnValue([]);

    const result = gate.check();

    expect(result.throttle).toBe("paused");
  });

  it("respects available channels parameter", () => {
    heartbeatStore.getLatestStatus.mockReturnValue(new Map([
      ["database", "healthy"],
    ]));
    trendDetector.analyzeAll.mockReturnValue([]);

    const result = gate.check(["telegram", "discord"]);

    expect(result.availableChannels).toEqual(["telegram", "discord"]);
  });

  it("determines status degraded on error component", () => {
    heartbeatStore.getLatestStatus.mockReturnValue(new Map([
      ["database", "error"],
      ["api", "healthy"],
    ]));
    trendDetector.analyzeAll.mockReturnValue([]);

    const result = gate.check();

    expect(result.throttle).not.toBe("normal");
  });

  it("caches result for interval", () => {
    heartbeatStore.getLatestStatus.mockReturnValue(new Map([
      ["database", "healthy"],
    ]));
    trendDetector.analyzeAll.mockReturnValue([]);

    gate.check();
    gate.check(); // Immediate second check

    // Should use cached result, not re-query
    expect(heartbeatStore.getLatestStatus).toHaveBeenCalledTimes(1);
  });

  it("returns result object with throttle and reason fields", () => {
    heartbeatStore.getLatestStatus.mockReturnValue(new Map([
      ["api", "healthy"],
    ]));
    trendDetector.analyzeAll.mockReturnValue([]);

    const result = gate.check();

    expect(result).toHaveProperty("throttle");
    expect(result).toHaveProperty("reason");
    expect(result).toHaveProperty("availableChannels");
  });
});
