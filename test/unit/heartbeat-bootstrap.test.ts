import { describe, it, expect, vi, beforeEach } from "vitest";

const { HeartbeatStoreMock, ActivityTrackerMock, HeartbeatEngineMock } = vi.hoisted(() => ({
  HeartbeatStoreMock: vi.fn(),
  ActivityTrackerMock: vi.fn(),
  HeartbeatEngineMock: vi.fn(),
}));

vi.mock("../../src/heartbeat/store.js", () => ({ HeartbeatStore: HeartbeatStoreMock }));
vi.mock("../../src/heartbeat/activity.js", () => ({ ActivityTracker: ActivityTrackerMock }));
vi.mock("../../src/heartbeat/engine.js", () => ({ HeartbeatEngine: HeartbeatEngineMock }));
vi.mock("../../src/heartbeat/checkers.js", () => ({
  BridgeChecker: vi.fn(() => ({ kind: "bridge" })),
  ChannelChecker: vi.fn(() => ({ kind: "channel" })),
  VaultChecker: vi.fn(() => ({ kind: "vault" })),
  SessionChecker: vi.fn(() => ({ kind: "session" })),
  MemoryChecker: vi.fn(() => ({ kind: "memory" })),
}));

import { bootstrapHeartbeat, startHeartbeatEngine } from "../../src/gateway/heartbeat-bootstrap.js";

describe("heartbeat bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates heartbeat store and activity tracker when enabled", () => {
    HeartbeatStoreMock.mockImplementation(() => ({ id: "store" }));
    ActivityTrackerMock.mockImplementation(() => ({ id: "tracker" }));
    const logger = { info: vi.fn() } as any;

    const result = bootstrapHeartbeat({ heartbeat: { enabled: true } } as any, logger, {} as any, {} as any);

    expect(result.heartbeatStore).toEqual({ id: "store" });
    expect(result.activityTracker).toEqual({ id: "tracker" });
    expect(logger.info).toHaveBeenCalledWith("Heartbeat store initialized");
  });

  it("starts engine and wires it to tool server", () => {
    const start = vi.fn();
    const engine = { start };
    HeartbeatEngineMock.mockImplementation(() => engine);

    const toolServer = { setHeartbeatEngine: vi.fn() } as any;
    const logger = { info: vi.fn() } as any;
    const bridge = { getInFlightCount: vi.fn().mockReturnValue(0) } as any;

    const result = startHeartbeatEngine(
      { heartbeat: { enabled: true } } as any,
      logger,
      {} as any,
      toolServer,
      bridge,
      {} as any,
      {} as any,
      {} as any,
    );

    expect(result).toBe(engine);
    expect(start).toHaveBeenCalledTimes(1);
    expect(toolServer.setHeartbeatEngine).toHaveBeenCalledWith(engine);
  });
});
