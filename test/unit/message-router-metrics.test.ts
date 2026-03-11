import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { metrics } from "../../src/gateway/metrics.js";

vi.mock("../../src/gateway/metrics.js", () => ({
  metrics: {
    messagesReceived: { inc: vi.fn() },
    messagesSent: { inc: vi.fn() },
    messagesErrors: { inc: vi.fn() },
    messageProcessingLatency: { observe: vi.fn() },
    queueDepth: { set: vi.fn() },
    activeConnections: { inc: vi.fn() },
    uptime: { set: vi.fn() },
    systemHealth: { set: vi.fn() },
    arcsDetected: { inc: vi.fn() },
    outcomesLogged: { inc: vi.fn() },
    intentsTriggered: { inc: vi.fn() },
    intelligencePipelineLatency: { observe: vi.fn() },
  },
}));

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageRouter } from "../../src/bridge/message-router.js";
import { SessionMap } from "../../src/bridge/session-map.js";
import { SecurityGate } from "../../src/security/dm-policy.js";
import { PairingStore } from "../../src/security/pairing-store.js";
import { AllowlistStore } from "../../src/security/allowlist-store.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { MockAdapter } from "../helpers/mock-adapter.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";
import { makeInboundMessage } from "../helpers/fixtures.js";
import pino from "pino";

function setup() {
  const tempDir = mkdtempSync(join(tmpdir(), "iris-metrics-test-"));
  writeFileSync(join(tempDir, "pairing.json"), "[]");
  writeFileSync(join(tempDir, "allowlist.json"), "[]");
  const bridge = new MockOpenCodeBridge();
  const sessionMap = new SessionMap(tempDir);
  const securityGate = new SecurityGate(
    new PairingStore(tempDir), new AllowlistStore(tempDir),
    new RateLimiter({ perMinute: 30, perHour: 300 }),
    { defaultDmPolicy: "open", pairingCodeTtlMs: 3_600_000, pairingCodeLength: 8, rateLimitPerMinute: 30, rateLimitPerHour: 300 },
  );
  const registry = new ChannelRegistry();
  registry.register(new MockAdapter());
  const router = new MessageRouter(bridge as any, sessionMap, securityGate, registry, pino({ level: "silent" }));
  return { router, bridge, tempDir };
}

describe("MessageRouter metric instrumentation", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { vi.clearAllMocks(); ctx = setup(); });
  afterEach(() => { rmSync(ctx.tempDir, { recursive: true, force: true }); });

  it("increments messagesReceived on every inbound message", async () => {
    await ctx.router.handleInbound(makeInboundMessage({ channelId: "mock" }));
    expect(metrics.messagesReceived.inc).toHaveBeenCalledWith({ channel: "mock" });
  });

  it("records messageProcessingLatency after processing", async () => {
    await ctx.router.handleInbound(makeInboundMessage({ channelId: "mock" }));
    expect(metrics.messageProcessingLatency.observe).toHaveBeenCalledWith(
      { channel: "mock", stage: "full" }, expect.any(Number)
    );
  });

  it("increments messagesSent when bridge returns text", async () => {
    ctx.bridge.responseText = "reply from bridge";
    await ctx.router.handleInbound(makeInboundMessage({ channelId: "mock" }));
    await new Promise(r => setTimeout(r, 30));
    expect(metrics.messagesSent.inc).toHaveBeenCalledWith({ channel: "mock" });
  });

  it("increments messagesErrors with empty_response when bridge returns empty", async () => {
    ctx.bridge.responseText = "";
    await ctx.router.handleInbound(makeInboundMessage({ channelId: "mock" }));
    expect(metrics.messagesErrors.inc).toHaveBeenCalledWith({ channel: "mock", error_type: "empty_response" });
  });

  it("increments messagesErrors with bridge_error when bridge throws", async () => {
    vi.spyOn(ctx.bridge, "sendAndWait").mockRejectedValue(new Error("bridge down"));
    await ctx.router.handleInbound(makeInboundMessage({ channelId: "mock" })).catch(() => {});
    expect(metrics.messagesErrors.inc).toHaveBeenCalledWith({ channel: "mock", error_type: "bridge_error" });
  });

  it("does not increment messagesSent on bridge error", async () => {
    vi.spyOn(ctx.bridge, "sendAndWait").mockRejectedValue(new Error("fail"));
    await ctx.router.handleInbound(makeInboundMessage({ channelId: "mock" })).catch(() => {});
    expect(metrics.messagesSent.inc).not.toHaveBeenCalled();
  });
});
