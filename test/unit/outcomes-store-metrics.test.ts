import { describe, it, expect, vi, beforeEach } from "vitest";
import { metrics } from "../../src/gateway/metrics.js";

vi.mock("../../src/gateway/metrics.js", () => ({
  metrics: {
    outcomesLogged: { inc: vi.fn() },
    messagesReceived: { inc: vi.fn() },
    messagesSent: { inc: vi.fn() },
    messagesErrors: { inc: vi.fn() },
    messageProcessingLatency: { observe: vi.fn() },
    queueDepth: { set: vi.fn() },
    activeConnections: { inc: vi.fn() },
    uptime: { set: vi.fn() },
    systemHealth: { set: vi.fn() },
    arcsDetected: { inc: vi.fn() },
    intentsTriggered: { inc: vi.fn() },
    intelligencePipelineLatency: { observe: vi.fn() },
  },
}));

import { OutcomesStore } from "../../src/intelligence/outcomes/store.js";

function makeVaultDb() {
  const stmt = { run: vi.fn(), all: vi.fn().mockReturnValue([]), get: vi.fn() };
  const rawDb = { prepare: vi.fn().mockReturnValue(stmt), exec: vi.fn() } as any;
  return { raw: vi.fn().mockReturnValue(rawDb) } as any;
}

describe("OutcomesStore metric instrumentation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("increments outcomesLogged with outcome category on log()", async () => {
    const store = new OutcomesStore(makeVaultDb());
    store.recordOutcome({ intentId: "i1", senderId: "u1", channelId: "tg", category: "goal", sentAt: Date.now(), dayOfWeek: 1, hourOfDay: 10 });
    expect(metrics.outcomesLogged.inc).toHaveBeenCalledWith({ type: "goal" });
  });

  it("increments outcomesLogged with correct category for different types", async () => {
    const store = new OutcomesStore(makeVaultDb());
    store.recordOutcome({ intentId: "i2", senderId: "u1", channelId: "tg", category: "task", sentAt: Date.now(), dayOfWeek: 2, hourOfDay: 11 });
    expect(metrics.outcomesLogged.inc).toHaveBeenCalledWith({ type: "task" });
  });
});
