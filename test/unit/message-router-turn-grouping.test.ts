import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { CircuitBreaker } from "../../src/bridge/circuit-breaker.js";
import { MockAdapter } from "../helpers/mock-adapter.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";
import { makeInboundMessage } from "../helpers/fixtures.js";
import pino from "pino";

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

/**
 * A bridge variant that exposes a real CircuitBreaker so tests can drive it
 * to OPEN without going through sendAndWait (which triggers restart scheduling).
 */
class ControllableBridge extends MockOpenCodeBridge {
  readonly _cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 10_000 });
  override getCircuitBreaker() { return this._cb; }
}

function makeEnv() {
  const tempDir = mkdtempSync(join(tmpdir(), "iris-mr-turns-"));
  writeFileSync(join(tempDir, "pairing.json"), "[]");
  writeFileSync(join(tempDir, "allowlist.json"), "[]");

  const bridge = new ControllableBridge();
  const sessionMap = new SessionMap(tempDir);
  const securityGate = new SecurityGate(
    new PairingStore(tempDir),
    new AllowlistStore(tempDir),
    new RateLimiter({ perMinute: 30, perHour: 300 }),
    {
      defaultDmPolicy: "open",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 30,
      rateLimitPerHour: 300,
    },
  );
  const registry = new ChannelRegistry();
  const adapter = new MockAdapter();
  registry.register(adapter);

  const router = new MessageRouter(
    bridge as any,
    sessionMap,
    securityGate,
    registry,
    pino({ level: "silent" }),
  );

  return { tempDir, bridge, adapter, router };
}

describe("MessageRouter — idle window flush and error recovery edge paths", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("/new command resets the session and sends confirmation without forwarding to AI", async () => {
    const { router, adapter, tempDir } = makeEnv();
    try {
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "/new" }));

      const sends = adapter.calls.filter(c => c.method === "sendText");
      expect(sends.length).toBe(1);
      expect((sends[0]!.args[0] as any).text).toContain("Session reset");

      // /new exits before step 8 (typing indicator), so no typing should be sent
      expect(adapter.calls.filter(c => c.method === "sendTyping").length).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("/start command behaves identically to /new", async () => {
    const { router, adapter, tempDir } = makeEnv();
    try {
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "/start" }));

      const sends = adapter.calls.filter(c => c.method === "sendText");
      expect(sends.length).toBe(1);
      expect((sends[0]!.args[0] as any).text).toContain("Session reset");
      expect(adapter.calls.filter(c => c.method === "sendTyping").length).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("when circuit is OPEN, sends unavailability notice and does not call sendAndWait", async () => {
    const { router, adapter, bridge, tempDir } = makeEnv();
    try {
      // Open the circuit directly — avoids restart-scheduler side effects
      bridge._cb.onFailure(); bridge._cb.onFailure(); bridge._cb.onFailure();
      expect(bridge._cb.getState()).toBe("OPEN");

      const sendAndWaitSpy = vi.spyOn(bridge, "sendAndWait");
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "hello" }));

      expect(sendAndWaitSpy).not.toHaveBeenCalled();
      const sends = adapter.calls.filter(c => c.method === "sendText");
      expect(sends.length).toBe(1);
      expect((sends[0]!.args[0] as any).text).toContain("temporarily unavailable");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("propagates error from bridge.sendAndWait and does not deliver a text response", async () => {
    const { router, adapter, bridge, tempDir } = makeEnv();
    try {
      vi.spyOn(bridge, "sendAndWait").mockRejectedValue(new Error("transport failure"));

      await expect(
        router.handleInbound(makeInboundMessage({ channelId: "mock", text: "ping" })),
      ).rejects.toThrow("transport failure");

      // Only a typing indicator was sent; no text response
      const sends = adapter.calls.filter(c => c.method === "sendText");
      expect(sends.length).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("when bridge returns empty string, a fallback message is delivered to the channel", async () => {
    const { router, adapter, bridge, tempDir } = makeEnv();
    try {
      bridge.responseText = "";
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "hello" }));

      // Flush any pending timers/microtasks from the outbound queue
      await vi.advanceTimersByTimeAsync(500);

      const sends = adapter.calls.filter(c => c.method === "sendText");
      expect(sends.length).toBe(1);
      expect(sends[0].args[0].text).toContain("No response received");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles multiple sequential inbound messages independently", async () => {
    const { router, bridge, tempDir } = makeEnv();
    try {
      bridge.responseText = "ok";
      const msg1 = makeInboundMessage({ channelId: "mock", text: "first", id: "id-1" });
      const msg2 = makeInboundMessage({ channelId: "mock", text: "second", id: "id-2" });

      // Both should resolve without throwing
      await router.handleInbound(msg1);
      await router.handleInbound(msg2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resets session to fresh state on /new so next message starts a new AI session", async () => {
    const { router, bridge, tempDir } = makeEnv();
    try {
      // First, send a normal message to create a session
      bridge.responseText = "reply";
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "first message" }));

      // Track session IDs created
      const sessionsBeforeReset = [...bridge.sessions.keys()];

      // /new should reset the session mapping
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "/new" }));

      // A fresh message after /new creates a new session
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "after reset" }));

      const allSessions = [...bridge.sessions.keys()];
      // There should be at least two distinct sessions (one before reset, one after)
      expect(allSessions.length).toBeGreaterThanOrEqual(sessionsBeforeReset.length + 1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
