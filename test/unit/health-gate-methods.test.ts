/**
 * Unit tests for HealthGate: shouldProceed(), getHealthHints(), getCurrentThrottle()
 * Issue #107 — coverage fix (extends health-gate-throttle.test.ts)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthGate } from "../../src/intelligence/health/gate.js";

function makeGate(overrides: { latestStatus?: Map<string, string>; trends?: any[] } = {}) {
  const heartbeatStore = {
    getLatestStatus: vi.fn().mockReturnValue(overrides.latestStatus ?? new Map()),
    recordStatus: vi.fn(),
  };
  const trendDetector = {
    analyzeAll: vi.fn().mockReturnValue(overrides.trends ?? []),
    analyze: vi.fn(),
  };
  const bus = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() };
  const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };

  return new HealthGate(heartbeatStore as any, trendDetector as any, bus as any, logger as any);
}

// ─── getCurrentThrottle ───────────────────────────────────────────────────────

describe("getCurrentThrottle()", () => {
  it("returns 'normal' before any check is made", () => {
    const gate = makeGate();
    expect(gate.getCurrentThrottle()).toBe("normal");
  });

  it("reflects throttle after check with healthy system", () => {
    const gate = makeGate({ latestStatus: new Map([["db", "healthy"]]) });
    gate.check();
    expect(gate.getCurrentThrottle()).toBe("normal");
  });

  it("reflects 'reduced' throttle after check with one unhealthy component", () => {
    const gate = makeGate({ latestStatus: new Map([["db", "unhealthy"]]) });
    gate.check();
    expect(gate.getCurrentThrottle()).toBe("reduced");
  });

  it("reflects 'paused' throttle after critical component status", () => {
    const gate = makeGate({ latestStatus: new Map([["db", "critical"]]) });
    gate.check();
    expect(gate.getCurrentThrottle()).toBe("paused");
  });
});

// ─── shouldProceed() ─────────────────────────────────────────────────────────

describe("shouldProceed() — normal throttle", () => {
  it("allows normal priority when throttle is normal", () => {
    const gate = makeGate();
    gate.check();
    expect(gate.shouldProceed("normal")).toBe(true);
  });

  it("allows critical priority when throttle is normal", () => {
    const gate = makeGate();
    gate.check();
    expect(gate.shouldProceed("critical")).toBe(true);
  });

  it("allows low priority when throttle is normal", () => {
    const gate = makeGate();
    gate.check();
    expect(gate.shouldProceed("low")).toBe(true);
  });

  it("defaults to 'normal' priority when no argument", () => {
    const gate = makeGate();
    gate.check();
    expect(gate.shouldProceed()).toBe(true);
  });
});

describe("shouldProceed() — reduced throttle", () => {
  let gate: HealthGate;

  beforeEach(() => {
    gate = makeGate({ latestStatus: new Map([["db", "unhealthy"]]) });
    gate.check();
  });

  it("allows normal priority", () => {
    expect(gate.shouldProceed("normal")).toBe(true);
  });

  it("allows critical priority", () => {
    expect(gate.shouldProceed("critical")).toBe(true);
  });

  it("blocks low priority", () => {
    expect(gate.shouldProceed("low")).toBe(false);
  });
});

describe("shouldProceed() — minimal throttle", () => {
  let gate: HealthGate;

  beforeEach(() => {
    gate = makeGate({
      latestStatus: new Map([["a", "unhealthy"], ["b", "unhealthy"], ["c", "unhealthy"]]),
    });
    gate.check();
  });

  it("allows critical priority", () => {
    expect(gate.shouldProceed("critical")).toBe(true);
  });

  it("blocks normal priority", () => {
    expect(gate.shouldProceed("normal")).toBe(false);
  });

  it("blocks low priority", () => {
    expect(gate.shouldProceed("low")).toBe(false);
  });
});

describe("shouldProceed() — paused throttle", () => {
  let gate: HealthGate;

  beforeEach(() => {
    gate = makeGate({ latestStatus: new Map([["api", "critical"]]) });
    gate.check();
  });

  it("blocks all priorities including critical", () => {
    expect(gate.shouldProceed("critical")).toBe(false);
    expect(gate.shouldProceed("normal")).toBe(false);
    expect(gate.shouldProceed("low")).toBe(false);
  });
});

// ─── getHealthHints() ─────────────────────────────────────────────────────────

describe("getHealthHints()", () => {
  it("returns null when throttle is normal", () => {
    const gate = makeGate();
    gate.check(); // sets to normal
    expect(gate.getHealthHints()).toBeNull();
  });

  it("returns null when degrading but no degrading trends available", () => {
    const gate = makeGate({
      latestStatus: new Map([["db", "unhealthy"]]),
      trends: [], // no degrading trends
    });
    gate.check();
    // throttle is 'reduced', but trendDetector returns no degrading
    expect(gate.getHealthHints()).toBeNull();
  });

  it("returns health hint string when throttle is non-normal and trends are degrading", () => {
    // Need to get a non-normal throttle first
    const heartbeatStore = {
      getLatestStatus: vi.fn()
        .mockReturnValueOnce(new Map([["db", "unhealthy"]])) // first check → reduced
        .mockReturnValue(new Map([["db", "unhealthy"]])),
    };
    const trendDetector = {
      analyzeAll: vi.fn().mockReturnValue([
        { component: "database", metric: "latency_ms", trend: "degrading", predictedThresholdIn: null },
      ]),
    };
    const bus = { emit: vi.fn() };
    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const gate = new HealthGate(
      heartbeatStore as any, trendDetector as any, bus as any, logger as any,
    );
    gate.check();

    const hints = gate.getHealthHints();
    expect(hints).not.toBeNull();
    expect(hints).toContain("SYSTEM HEALTH");
    expect(hints).toContain("database");
    expect(hints).toContain("degrading");
  });

  it("includes predicted threshold time in hints when available", () => {
    const heartbeatStore = {
      getLatestStatus: vi.fn().mockReturnValue(new Map([["db", "unhealthy"]])),
    };
    const trendDetector = {
      analyzeAll: vi.fn().mockReturnValue([
        {
          component: "api",
          metric: "latency_ms",
          trend: "critical_trajectory",
          predictedThresholdIn: 3_600_000, // 1 hour
        },
      ]),
    };
    const bus = { emit: vi.fn() };
    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const gate = new HealthGate(
      heartbeatStore as any, trendDetector as any, bus as any, logger as any,
    );
    gate.check();

    const hints = gate.getHealthHints();
    expect(hints).not.toBeNull();
    expect(hints).toContain("predicted breach in 1h");
  });
});

// ─── Throttle change events ───────────────────────────────────────────────────

describe("bus.emit on throttle change", () => {
  it("emits health_changed event when throttle transitions from normal to reduced", () => {
    const heartbeatStore = {
      getLatestStatus: vi.fn().mockReturnValue(new Map([["db", "unhealthy"]])),
    };
    const trendDetector = { analyzeAll: vi.fn().mockReturnValue([]) };
    const bus = { emit: vi.fn() };
    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const gate = new HealthGate(
      heartbeatStore as any, trendDetector as any, bus as any, logger as any,
    );

    gate.check();

    expect(bus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "health_changed",
      component: "health_gate",
      status: "reduced",
    }));
  });

  it("does NOT emit event when throttle stays the same", () => {
    const heartbeatStore = {
      getLatestStatus: vi.fn().mockReturnValue(new Map()),
    };
    const trendDetector = { analyzeAll: vi.fn().mockReturnValue([]) };
    const bus = { emit: vi.fn() };
    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const gate = new HealthGate(
      heartbeatStore as any, trendDetector as any, bus as any, logger as any,
    );

    gate.check(); // normal → normal
    bus.emit.mockClear();

    // Force re-check by creating fresh gate (cache bypassed)
    const gate2 = new HealthGate(
      heartbeatStore as any, trendDetector as any, bus as any, logger as any,
    );
    gate2.check(); // still normal
    expect(bus.emit).not.toHaveBeenCalled();
  });
});

// ─── Channel availability in check() ─────────────────────────────────────────

describe("channel availability", () => {
  it("marks degraded channels as queued when they match component:channel: prefix", () => {
    const heartbeatStore = {
      getLatestStatus: vi.fn().mockReturnValue(new Map([
        ["channel:telegram", "unhealthy"],
        ["channel:discord", "healthy"],
      ])),
    };
    const trendDetector = { analyzeAll: vi.fn().mockReturnValue([]) };
    const bus = { emit: vi.fn() };
    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const gate = new HealthGate(
      heartbeatStore as any, trendDetector as any, bus as any, logger as any,
    );

    const result = gate.check(["telegram", "discord", "slack"]);
    expect(result.queuedChannels).toContain("telegram");
    expect(result.availableChannels).toContain("discord");
    expect(result.availableChannels).toContain("slack");
  });
});
