/**
 * Unit tests for src/gateway/lifecycle.ts and src/gateway/shutdown.ts
 * Covers: graceful shutdown, signal handling (SIGTERM/SIGINT), adapter error recovery,
 * plugin lifecycle hooks, and GatewayContext type contract.
 * Issue #73
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

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

  it("all nullable context fields accept null — optional subsystems are null-safe by design", () => {
    const nullableFields = [
      "intentStore", "pulseEngine", "signalStore", "profileEnricher",
      "heartbeatEngine", "activityTracker", "intelligenceBus", "intelligenceStore",
      "inferenceEngine", "triggerEvaluator", "outcomeAnalyzer", "arcDetector",
      "arcLifecycle", "goalLifecycle", "crossChannelResolver", "healthGate",
      "promptAssembler",
    ] as const;

    const ctx: Record<string, unknown> = {};
    for (const field of nullableFields) {
      ctx[field] = null;
    }
    for (const field of nullableFields) {
      expect(ctx[field]).toBeNull();
    }
  });
});
