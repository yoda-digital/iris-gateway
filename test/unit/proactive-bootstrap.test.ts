import { describe, it, expect, vi, beforeEach } from "vitest";

const { IntentStoreMock, PulseEngineMock } = vi.hoisted(() => ({
  IntentStoreMock: vi.fn(),
  PulseEngineMock: vi.fn(),
}));

vi.mock("../../src/proactive/store.js", () => ({ IntentStore: IntentStoreMock }));
vi.mock("../../src/proactive/engine.js", () => ({ PulseEngine: PulseEngineMock }));

import { bootstrapProactive, startPulseEngine } from "../../src/gateway/proactive-bootstrap.js";

describe("proactive bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates intent store when proactive is enabled", () => {
    IntentStoreMock.mockImplementation(() => ({ id: "intent-store" }));
    const logger = { info: vi.fn() } as any;

    const result = bootstrapProactive({ proactive: { enabled: true } } as any, logger, {} as any);

    expect(result.intentStore).toEqual({ id: "intent-store" });
    expect(logger.info).toHaveBeenCalledWith("Proactive intent store initialized");
  });

  it("starts pulse engine when enabled and intent store exists", () => {
    const start = vi.fn();
    const engine = { start };
    PulseEngineMock.mockImplementation(() => engine);

    const logger = { info: vi.fn() } as any;

    const result = startPulseEngine(
      { proactive: { enabled: true } } as any,
      logger,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    expect(result).toBe(engine);
    expect(start).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("Proactive pulse engine started");
  });
});
