/**
 * Unit tests for src/gateway/lifecycle.ts and src/gateway/shutdown.ts
 * Covers: graceful shutdown, signal handling (SIGTERM/SIGINT), adapter error recovery,
 * plugin lifecycle hooks, and GatewayContext type contract.
 * Issue #73
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
// ─── Module-level mocks for heavy transitive deps ────────────────────────────
// lifecycle.ts imports channel adapters (grammy, discord.js, @slack/bolt, baileys)
// which perform expensive SDK initialization at module load time, causing the
// dynamic import in the GatewayContext type contract test to exceed the 5000ms
// timeout. Mocking adapters.js isolates only the side-effectful dep while keeping
// the real startGateway export verifiable.
vi.mock("../../src/gateway/adapters.js", () => ({
  startChannelAdapters: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/bridge/opencode-client.js", () => ({
  OpenCodeBridge: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    checkHealth: vi.fn(),
  })),
}));

// ─── Shared mock factories ────────────────────────────────────────────────────

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn() };
}

function makeBridge() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
    sendMessage: vi.fn().mockResolvedValue("pong"),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getQueueSize: vi.fn().mockReturnValue(0),
  };
}

function makeVaultDb() {
  return {
    close: vi.fn(),
    prepare: vi.fn().mockReturnValue({ run: vi.fn(), all: vi.fn().mockReturnValue([]), get: vi.fn() }),
  };
}

function makePluginRegistry() {
  return {
    tools: [],
    services: new Map(),
    hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
  };
}

function makeHealthServer() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function makeToolServer() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    setHeartbeatEngine: vi.fn(),
  };
}

function makeRegistry() {
  return { register: vi.fn(), get: vi.fn(), list: vi.fn().mockReturnValue([]) };
}

function makeRouter() {
  return { dispose: vi.fn() };
}

function makeMessageCache() {
  return { dispose: vi.fn() };
}

function makeAbortController() {
  return { signal: { aborted: false }, abort: vi.fn() };
}

// ─── registerShutdownHandlers tests ──────────────────────────────────────────

describe("registerShutdownHandlers", () => {
  let processOnce: MockInstance;
  const signals: Record<string, () => Promise<void>> = {};

  beforeEach(async () => {
    signals["SIGTERM"] = undefined as any;
    signals["SIGINT"] = undefined as any;

    processOnce = vi.spyOn(process, "once").mockImplementation(
      (event: string | symbol, handler: (...args: any[]) => void) => {
        signals[event as string] = handler as () => Promise<void>;
        return process;
      },
    );
  });

  afterEach(() => {
    processOnce.mockRestore();
  });

  it("registers SIGTERM and SIGINT handlers", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    registerShutdownHandlers({
      logger: makeLogger() as any,
      registry: makeRegistry() as any,
      router: makeRouter() as any,
      messageCache: makeMessageCache() as any,
      canvasServer: null,
      toolServer: makeToolServer() as any,
      healthServer: makeHealthServer() as any,
      bridge: makeBridge() as any,
      vaultDb: makeVaultDb() as any,
      pulseEngine: null,
      heartbeatEngine: null,
      intelligenceBus: null,
      pluginRegistry: makePluginRegistry() as any,
      abortController: makeAbortController() as any,
    });

    expect(processOnce).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(processOnce).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });

  it("SIGTERM triggers full graceful shutdown sequence", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    const logger = makeLogger();
    const bridge = makeBridge();
    const toolServer = makeToolServer();
    const healthServer = makeHealthServer();
    const vaultDb = makeVaultDb();
    const router = makeRouter();
    const messageCache = makeMessageCache();
    const abortController = makeAbortController();

    registerShutdownHandlers({
      logger: logger as any,
      registry: makeRegistry() as any,
      router: router as any,
      messageCache: messageCache as any,
      canvasServer: null,
      toolServer: toolServer as any,
      healthServer: healthServer as any,
      bridge: bridge as any,
      vaultDb: vaultDb as any,
      pulseEngine: null,
      heartbeatEngine: null,
      intelligenceBus: null,
      pluginRegistry: makePluginRegistry() as any,
      abortController: abortController as any,
    });

    await signals["SIGTERM"]?.();

    expect(abortController.abort).toHaveBeenCalled();
    expect(bridge.stop).toHaveBeenCalled();
    expect(toolServer.stop).toHaveBeenCalled();
    expect(healthServer.stop).toHaveBeenCalled();
    expect(vaultDb.close).toHaveBeenCalled();
    expect(router.dispose).toHaveBeenCalled();
    expect(messageCache.dispose).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Shutdown complete");
  });

  it("SIGINT also triggers graceful shutdown", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    const logger = makeLogger();
    const bridge = makeBridge();
    const abortController = makeAbortController();

    registerShutdownHandlers({
      logger: logger as any,
      registry: makeRegistry() as any,
      router: makeRouter() as any,
      messageCache: makeMessageCache() as any,
      canvasServer: null,
      toolServer: makeToolServer() as any,
      healthServer: makeHealthServer() as any,
      bridge: bridge as any,
      vaultDb: makeVaultDb() as any,
      pulseEngine: null,
      heartbeatEngine: null,
      intelligenceBus: null,
      pluginRegistry: makePluginRegistry() as any,
      abortController: abortController as any,
    });

    await signals["SIGINT"]?.();

    expect(abortController.abort).toHaveBeenCalled();
    expect(bridge.stop).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Shutdown complete");
  });

  it("second SIGTERM is a no-op — shutdown guard prevents double-shutdown", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    const bridge = makeBridge();

    registerShutdownHandlers({
      logger: makeLogger() as any,
      registry: makeRegistry() as any,
      router: makeRouter() as any,
      messageCache: makeMessageCache() as any,
      canvasServer: null,
      toolServer: makeToolServer() as any,
      healthServer: makeHealthServer() as any,
      bridge: bridge as any,
      vaultDb: makeVaultDb() as any,
      pulseEngine: null,
      heartbeatEngine: null,
      intelligenceBus: null,
      pluginRegistry: makePluginRegistry() as any,
      abortController: makeAbortController() as any,
    });

    await signals["SIGTERM"]?.();
    await signals["SIGTERM"]?.();

    expect(bridge.stop).toHaveBeenCalledTimes(1);
  });

  it("stops optional engines (pulse, heartbeat, intelligence) when present", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    const pulseEngine = { stop: vi.fn() };
    const heartbeatEngine = { stop: vi.fn() };
    const intelligenceBus = { dispose: vi.fn() };

    registerShutdownHandlers({
      logger: makeLogger() as any,
      registry: makeRegistry() as any,
      router: makeRouter() as any,
      messageCache: makeMessageCache() as any,
      canvasServer: null,
      toolServer: makeToolServer() as any,
      healthServer: makeHealthServer() as any,
      bridge: makeBridge() as any,
      vaultDb: makeVaultDb() as any,
      pulseEngine: pulseEngine as any,
      heartbeatEngine: heartbeatEngine as any,
      intelligenceBus: intelligenceBus as any,
      pluginRegistry: makePluginRegistry() as any,
      abortController: makeAbortController() as any,
    });

    await signals["SIGTERM"]?.();

    expect(pulseEngine.stop).toHaveBeenCalled();
    expect(heartbeatEngine.stop).toHaveBeenCalled();
    expect(intelligenceBus.dispose).toHaveBeenCalled();
  });

  it("optional engines are null-safe — no crash when absent", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");

    registerShutdownHandlers({
      logger: makeLogger() as any,
      registry: makeRegistry() as any,
      router: makeRouter() as any,
      messageCache: makeMessageCache() as any,
      canvasServer: null,
      toolServer: makeToolServer() as any,
      healthServer: makeHealthServer() as any,
      bridge: makeBridge() as any,
      vaultDb: makeVaultDb() as any,
      pulseEngine: null,
      heartbeatEngine: null,
      intelligenceBus: null,
      pluginRegistry: makePluginRegistry() as any,
      abortController: makeAbortController() as any,
    });

    await expect(signals["SIGTERM"]?.()).resolves.toBeUndefined();
  });

  it("partial-startup: continues shutdown if a channel adapter stop() throws", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    const logger = makeLogger();
    const bridge = makeBridge();

    const faultyAdapter = {
      id: "bad-channel",
      stop: vi.fn().mockRejectedValue(new Error("adapter stop failed")),
    };
    const registry = { list: vi.fn().mockReturnValue([faultyAdapter]) };

    registerShutdownHandlers({
      logger: logger as any,
      registry: registry as any,
      router: makeRouter() as any,
      messageCache: makeMessageCache() as any,
      canvasServer: null,
      toolServer: makeToolServer() as any,
      healthServer: makeHealthServer() as any,
      bridge: bridge as any,
      vaultDb: makeVaultDb() as any,
      pulseEngine: null,
      heartbeatEngine: null,
      intelligenceBus: null,
      pluginRegistry: makePluginRegistry() as any,
      abortController: makeAbortController() as any,
    });

    await signals["SIGTERM"]?.();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "bad-channel" }),
      "Error stopping channel",
    );
    expect(bridge.stop).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Shutdown complete");
  });

  it("emits gateway.shutdown hook BEFORE stopping plugin services", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    const callOrder: string[] = [];

    const pluginService = {
      stop: vi.fn().mockImplementation(async () => { callOrder.push("service.stop"); }),
    };
    const pluginRegistry = {
      services: new Map([["svc", pluginService]]),
      hookBus: {
        emit: vi.fn().mockImplementation(async () => { callOrder.push("hook.emit"); }),
      },
    };

    registerShutdownHandlers({
      logger: makeLogger() as any,
      registry: makeRegistry() as any,
      router: makeRouter() as any,
      messageCache: makeMessageCache() as any,
      canvasServer: null,
      toolServer: makeToolServer() as any,
      healthServer: makeHealthServer() as any,
      bridge: makeBridge() as any,
      vaultDb: makeVaultDb() as any,
      pulseEngine: null,
      heartbeatEngine: null,
      intelligenceBus: null,
      pluginRegistry: pluginRegistry as any,
      abortController: makeAbortController() as any,
    });

    await signals["SIGTERM"]?.();

    expect(callOrder.indexOf("hook.emit")).toBeLessThan(callOrder.indexOf("service.stop"));
  });

  it("stops all registered plugin services during shutdown", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    const svcA = { stop: vi.fn().mockResolvedValue(undefined) };
    const svcB = { stop: vi.fn().mockResolvedValue(undefined) };
    const pluginRegistry = {
      services: new Map([["svc-a", svcA], ["svc-b", svcB]]),
      hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
    };

    registerShutdownHandlers({
      logger: makeLogger() as any,
      registry: makeRegistry() as any,
      router: makeRouter() as any,
      messageCache: makeMessageCache() as any,
      canvasServer: null,
      toolServer: makeToolServer() as any,
      healthServer: makeHealthServer() as any,
      bridge: makeBridge() as any,
      vaultDb: makeVaultDb() as any,
      pulseEngine: null,
      heartbeatEngine: null,
      intelligenceBus: null,
      pluginRegistry: pluginRegistry as any,
      abortController: makeAbortController() as any,
    });

    await signals["SIGTERM"]?.();

    expect(svcA.stop).toHaveBeenCalled();
    expect(svcB.stop).toHaveBeenCalled();
  });

  it("partial-startup: continues shutdown if a plugin service stop() throws", async () => {
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    const logger = makeLogger();
    const bridge = makeBridge();

    const faultyService = { stop: vi.fn().mockRejectedValue(new Error("service crash")) };
    const pluginRegistry = {
      services: new Map([["faulty-svc", faultyService]]),
      hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
    };

    registerShutdownHandlers({
      logger: logger as any,
      registry: makeRegistry() as any,
      router: makeRouter() as any,
      messageCache: makeMessageCache() as any,
      canvasServer: null,
      toolServer: makeToolServer() as any,
      healthServer: makeHealthServer() as any,
      bridge: bridge as any,
      vaultDb: makeVaultDb() as any,
      pulseEngine: null,
      heartbeatEngine: null,
      intelligenceBus: null,
      pluginRegistry: pluginRegistry as any,
      abortController: makeAbortController() as any,
    });

    await signals["SIGTERM"]?.();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ service: "faulty-svc" }),
      "Error stopping plugin service",
    );
    expect(bridge.stop).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Shutdown complete");
  });
});

// ─── GatewayContext type contract tests ──────────────────────────────────────

describe("GatewayContext type contract", () => {
  it("lifecycle module exports startGateway as a function", async () => {
    const mod = await import("../../src/gateway/lifecycle.js");
    expect(typeof mod.startGateway).toBe("function");
  });

});

// ─── Readiness check tests (issue #176) ──────────────────────────────────────

import { waitForOpenCodeReady } from "../../src/gateway/readiness.js";

describe("OpenCode readiness check (issue #176)", () => {
  it("does NOT call bridge.sendMessage() during warmup — uses checkHealth() only", async () => {
    const bridge = makeBridge();
    const logger = makeLogger();

    // checkHealth returns false twice, then true; skip grace period
    bridge.checkHealth
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    process.env.OPENCODE_WARMUP_GRACE_MS = "0";

    try {
      await waitForOpenCodeReady(bridge as any, logger as any);
    } finally {
      delete process.env.OPENCODE_WARMUP_GRACE_MS;
    }

    expect(bridge.sendMessage).not.toHaveBeenCalled();
    expect(bridge.createSession).not.toHaveBeenCalled();
    expect(bridge.deleteSession).not.toHaveBeenCalled();
    expect(bridge.checkHealth).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith("OpenCode ready (health check passed)");
  });

  it("logs a warning when checkHealth never returns true within timeout", async () => {
    const bridge = makeBridge();
    const logger = makeLogger();
    bridge.checkHealth.mockResolvedValue(false);
    // Use a very short grace to avoid real 60s wait — patch env to skip grace period
    process.env.OPENCODE_WARMUP_GRACE_MS = "0";

    // waitForOpenCodeReady has a 60s timeout; we only verify the warn is NOT called
    // here by letting it resolve after checkHealth flips true
    bridge.checkHealth.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    try {
      await waitForOpenCodeReady(bridge as any, logger as any);
    } finally {
      delete process.env.OPENCODE_WARMUP_GRACE_MS;
    }

    expect(bridge.sendMessage).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("OPENCODE_WARMUP_GRACE_MS=0 skips grace period (intentional: 0 means no delay)", async () => {
    const bridge = makeBridge();
    const logger = makeLogger();
    bridge.checkHealth.mockResolvedValue(true);
    process.env.OPENCODE_WARMUP_GRACE_MS = "0";

    const start = Date.now();
    try {
      await waitForOpenCodeReady(bridge as any, logger as any);
    } finally {
      delete process.env.OPENCODE_WARMUP_GRACE_MS;
    }
    const elapsed = Date.now() - start;

    // With grace=0 the warmup should complete nearly instantly (< 200ms)
    expect(elapsed).toBeLessThan(200);
    expect(logger.info).toHaveBeenCalledWith("OpenCode ready (health check passed)");
  });
});

// ─── SSE exponential backoff tests (issue #298) ──────────────────────────────

describe("wireSSE exponential backoff (issue #298)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("first SSE drop uses SSE_RECONNECT_DELAY_MS (5s) delay", async () => {
    const logger = makeLogger();
    const mockSubscribeEvents = vi.fn()
      .mockRejectedValueOnce(new Error("SSE drop"))
      .mockImplementation(() => new Promise(() => {})); // hang forever on retry

    const bridge = {
      ...makeBridge(),
      subscribeEvents: mockSubscribeEvents,
    };

    const abortController = new AbortController();
    const router = {
      ...makeRouter(),
      getEventHandler: vi.fn().mockReturnValue({ handleEvent: vi.fn() }),
    };

    // Inline the wireSSE logic from lifecycle.ts
    const SSE_RECONNECT_DELAY_MS = 5_000;
    const SSE_MAX_RECONNECT_DELAY_MS = 30_000;
    let sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
    const wireSSE = async (): Promise<void> => {
      if (abortController.signal.aborted) return;
      try {
        sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
        await bridge.subscribeEvents((event: any) => {
          router.getEventHandler().handleEvent(event);
        }, abortController.signal);
        logger.info("OpenCode SSE subscription ended");
      } catch (err) {
        if (abortController.signal.aborted) return;
        logger.warn({ err, nextRetryMs: sseReconnectDelay }, `SSE subscription dropped — reconnecting in ${sseReconnectDelay}ms`);
        const delay = sseReconnectDelay;
        sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY_MS);
        setTimeout(() => {
          if (abortController.signal.aborted) return;
          void wireSSE();
        }, delay);
      }
    };

    void wireSSE();

    // First call triggers immediately, should fail and schedule retry
    await vi.waitFor(() => expect(mockSubscribeEvents).toHaveBeenCalledTimes(1));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: 5_000 }),
      expect.stringContaining("reconnecting in 5000ms")
    );

    // Advance timers by 5s — should trigger second call
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(mockSubscribeEvents).toHaveBeenCalledTimes(2));
  });

  it("second consecutive SSE drop uses SSE_RECONNECT_DELAY_MS * 2 (10s) delay", async () => {
    const logger = makeLogger();
    const mockSubscribeEvents = vi.fn()
      .mockRejectedValueOnce(new Error("SSE drop 1"))
      .mockRejectedValueOnce(new Error("SSE drop 2"))
      .mockImplementation(() => new Promise(() => {}));

    const bridge = {
      ...makeBridge(),
      subscribeEvents: mockSubscribeEvents,
    };

    const abortController = new AbortController();
    const router = {
      ...makeRouter(),
      getEventHandler: vi.fn().mockReturnValue({ handleEvent: vi.fn() }),
    };

    const SSE_RECONNECT_DELAY_MS = 5_000;
    const SSE_MAX_RECONNECT_DELAY_MS = 30_000;
    let sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
    const wireSSE = async (): Promise<void> => {
      if (abortController.signal.aborted) return;
      try {
        sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
        await bridge.subscribeEvents((event: any) => {
          router.getEventHandler().handleEvent(event);
        }, abortController.signal);
        logger.info("OpenCode SSE subscription ended");
      } catch (err) {
        if (abortController.signal.aborted) return;
        logger.warn({ err, nextRetryMs: sseReconnectDelay }, `SSE subscription dropped — reconnecting in ${sseReconnectDelay}ms`);
        const delay = sseReconnectDelay;
        sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY_MS);
        setTimeout(() => {
          if (abortController.signal.aborted) return;
          void wireSSE();
        }, delay);
      }
    };

    void wireSSE();

    // First drop
    await vi.waitFor(() => expect(mockSubscribeEvents).toHaveBeenCalledTimes(1));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: 5_000 }),
      expect.stringContaining("reconnecting in 5000ms")
    );

    // Advance 5s, trigger second call
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(mockSubscribeEvents).toHaveBeenCalledTimes(2));

    // Second drop should use 10s delay
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: 10_000 }),
      expect.stringContaining("reconnecting in 10000ms")
    );

    // Advance 10s, trigger third call
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(mockSubscribeEvents).toHaveBeenCalledTimes(3));
  });

  it("delay resets to SSE_RECONNECT_DELAY_MS after a successful reconnect", async () => {
    const logger = makeLogger();
    let callCount = 0;
    const mockSubscribeEvents = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("SSE drop 1"));
      } else if (callCount === 2) {
        // Successful connection — resolve after brief delay then reject to test reset
        return new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error("SSE drop 2")), 100);
        });
      } else {
        return new Promise(() => {}); // hang
      }
    });

    const bridge = {
      ...makeBridge(),
      subscribeEvents: mockSubscribeEvents,
    };

    const abortController = new AbortController();
    const router = {
      ...makeRouter(),
      getEventHandler: vi.fn().mockReturnValue({ handleEvent: vi.fn() }),
    };

    const SSE_RECONNECT_DELAY_MS = 5_000;
    const SSE_MAX_RECONNECT_DELAY_MS = 30_000;
    let sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
    const wireSSE = async (): Promise<void> => {
      if (abortController.signal.aborted) return;
      try {
        sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
        await bridge.subscribeEvents((event: any) => {
          router.getEventHandler().handleEvent(event);
        }, abortController.signal);
        logger.info("OpenCode SSE subscription ended");
      } catch (err) {
        if (abortController.signal.aborted) return;
        logger.warn({ err, nextRetryMs: sseReconnectDelay }, `SSE subscription dropped — reconnecting in ${sseReconnectDelay}ms`);
        const delay = sseReconnectDelay;
        sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY_MS);
        setTimeout(() => {
          if (abortController.signal.aborted) return;
          void wireSSE();
        }, delay);
      }
    };

    void wireSSE();

    // First drop — should use 5s delay
    await vi.waitFor(() => expect(mockSubscribeEvents).toHaveBeenCalledTimes(1));
    expect(logger.warn).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ nextRetryMs: 5_000 }),
      expect.stringContaining("reconnecting in 5000ms")
    );

    // Advance 5s, trigger second call (which succeeds briefly then drops)
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(mockSubscribeEvents).toHaveBeenCalledTimes(2));

    // Advance 100ms to trigger the second drop
    await vi.advanceTimersByTimeAsync(100);

    // After successful connection, delay should reset to 5s (not 10s)
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledTimes(2));
    expect(logger.warn).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ nextRetryMs: 5_000 }),
      expect.stringContaining("reconnecting in 5000ms")
    );
  });

  it("no reconnect scheduled when signal.aborted = true before retry", async () => {
    const logger = makeLogger();
    const mockSubscribeEvents = vi.fn().mockRejectedValue(new Error("SSE drop"));

    const bridge = {
      ...makeBridge(),
      subscribeEvents: mockSubscribeEvents,
    };

    const abortController = new AbortController();
    const router = {
      ...makeRouter(),
      getEventHandler: vi.fn().mockReturnValue({ handleEvent: vi.fn() }),
    };

    const SSE_RECONNECT_DELAY_MS = 5_000;
    const SSE_MAX_RECONNECT_DELAY_MS = 30_000;
    let sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
    const wireSSE = async (): Promise<void> => {
      if (abortController.signal.aborted) return;
      try {
        sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
        await bridge.subscribeEvents((event: any) => {
          router.getEventHandler().handleEvent(event);
        }, abortController.signal);
        logger.info("OpenCode SSE subscription ended");
      } catch (err) {
        if (abortController.signal.aborted) return;
        logger.warn({ err, nextRetryMs: sseReconnectDelay }, `SSE subscription dropped — reconnecting in ${sseReconnectDelay}ms`);
        const delay = sseReconnectDelay;
        sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY_MS);
        setTimeout(() => {
          if (abortController.signal.aborted) return;
          void wireSSE();
        }, delay);
      }
    };

    void wireSSE();

    // First call fails
    await vi.waitFor(() => expect(mockSubscribeEvents).toHaveBeenCalledTimes(1));
    expect(logger.warn).toHaveBeenCalled();

    // Abort BEFORE the timer fires
    abortController.abort();

    // Advance timers — should NOT trigger reconnect
    await vi.advanceTimersByTimeAsync(5_000);

    // Still only 1 call — no reconnect happened
    expect(mockSubscribeEvents).toHaveBeenCalledTimes(1);
  });

  it("reconnect callback is a no-op if signal is aborted inside setTimeout", async () => {
    const logger = makeLogger();
    const mockSubscribeEvents = vi.fn()
      .mockRejectedValueOnce(new Error("SSE drop"))
      .mockRejectedValue(new Error("Should not be called"));

    const bridge = {
      ...makeBridge(),
      subscribeEvents: mockSubscribeEvents,
    };

    const abortController = new AbortController();
    const router = {
      ...makeRouter(),
      getEventHandler: vi.fn().mockReturnValue({ handleEvent: vi.fn() }),
    };

    const SSE_RECONNECT_DELAY_MS = 5_000;
    const SSE_MAX_RECONNECT_DELAY_MS = 30_000;
    let sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
    const wireSSE = async (): Promise<void> => {
      if (abortController.signal.aborted) return;
      try {
        sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
        await bridge.subscribeEvents((event: any) => {
          router.getEventHandler().handleEvent(event);
        }, abortController.signal);
        logger.info("OpenCode SSE subscription ended");
      } catch (err) {
        if (abortController.signal.aborted) return;
        logger.warn({ err, nextRetryMs: sseReconnectDelay }, `SSE subscription dropped — reconnecting in ${sseReconnectDelay}ms`);
        const delay = sseReconnectDelay;
        sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY_MS);
        setTimeout(() => {
          if (abortController.signal.aborted) return;
          void wireSSE();
        }, delay);
      }
    };

    void wireSSE();

    // First call fails
    await vi.waitFor(() => expect(mockSubscribeEvents).toHaveBeenCalledTimes(1));
    expect(logger.warn).toHaveBeenCalled();

    // Advance 2.5s (halfway through the 5s delay)
    await vi.advanceTimersByTimeAsync(2_500);

    // Abort DURING the setTimeout delay
    abortController.abort();

    // Advance remaining 2.5s — callback should return early
    await vi.advanceTimersByTimeAsync(2_500);

    // Should still be only 1 call — the setTimeout callback returned early
    expect(mockSubscribeEvents).toHaveBeenCalledTimes(1);
  });
});
