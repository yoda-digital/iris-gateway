import Database from "better-sqlite3";
/**
 * Unit tests for src/gateway/lifecycle.ts — startGateway() function.
 * Mocks all heavy dependencies so no real network/file I/O occurs.
 * Issue #107 — coverage fix for lines 90–387
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks (hoisted by vitest) ─────────────────────────────────────────

vi.mock("../../src/config/loader.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/config/paths.js", () => ({
  getStateDir: vi.fn(() => "/tmp/test-iris-state"),
  ensureDir: vi.fn((p: string) => p),
}));
vi.mock("../../src/logging/logger.js", () => ({ createLogger: vi.fn() }));
vi.mock("../../src/bridge/opencode-client.js", () => ({ OpenCodeBridge: vi.fn() }));
vi.mock("../../src/bridge/session-map.js", () => ({ SessionMap: vi.fn(() => ({})) }));
vi.mock("../../src/bridge/message-router.js", () => ({
  MessageRouter: vi.fn(() => ({})),
}));
vi.mock("../../src/bridge/tool-server.js", () => ({
  ToolServer: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    setHeartbeatEngine: vi.fn(),
  })),
}));
vi.mock("../../src/channels/registry.js", () => ({ ChannelRegistry: vi.fn(() => ({})) }));
vi.mock("../../src/channels/message-cache.js", () => ({ MessageCache: vi.fn(() => ({})) }));
vi.mock("../../src/vault/db.js", () => ({ VaultDB: vi.fn(() => ({ close: vi.fn(), raw: vi.fn().mockReturnValue(new Database(":memory:")) })) }));
vi.mock("../../src/vault/store.js", () => ({ VaultStore: vi.fn(() => ({ upsertProfile: vi.fn() })) }));
vi.mock("../../src/vault/search.js", () => ({ VaultSearch: vi.fn(() => ({})) }));
vi.mock("../../src/governance/engine.js", () => ({
  GovernanceEngine: vi.fn(() => ({ getRules: vi.fn(() => []), getDirectivesBlock: vi.fn(() => "") })),
}));
vi.mock("../../src/governance/policy.js", () => ({
  PolicyEngine: vi.fn(() => ({ enabled: false })),
}));
vi.mock("../../src/plugins/loader.js", () => ({
  PluginLoader: vi.fn(() => ({
    loadAll: vi.fn().mockResolvedValue({
      tools: [],
      services: new Map(),
      channels: new Map(),
      hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
    }),
  })),
}));
vi.mock("../../src/auto-reply/engine.js", () => ({ TemplateEngine: vi.fn(() => ({})) }));
vi.mock("../../src/usage/tracker.js", () => ({ UsageTracker: vi.fn(() => ({})) }));
vi.mock("../../src/proactive/store.js", () => ({ IntentStore: vi.fn(() => ({ start: vi.fn() })) }));
vi.mock("../../src/proactive/engine.js", () => ({
  PulseEngine: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));
vi.mock("../../src/canvas/server.js", () => ({
  CanvasServer: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn(() => ({ clearComponents: vi.fn(), removeComponent: vi.fn() })),
  })),
}));
vi.mock("../../src/gateway/health.js", () => ({
  HealthServer: vi.fn(() => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() })),
}));
vi.mock("../../src/onboarding/signals.js", () => ({
  SignalStore: vi.fn(() => ({ getLatestSignal: vi.fn() })),
}));
vi.mock("../../src/onboarding/enricher.js", () => ({
  ProfileEnricher: vi.fn(() => ({ enrich: vi.fn() })),
}));
vi.mock("../../src/heartbeat/store.js", () => ({ HeartbeatStore: vi.fn(() => ({})) }));
vi.mock("../../src/heartbeat/engine.js", () => ({
  HeartbeatEngine: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));
vi.mock("../../src/heartbeat/activity.js", () => ({
  ActivityTracker: vi.fn(() => ({ recordMessage: vi.fn() })),
}));
vi.mock("../../src/heartbeat/checkers.js", () => ({
  BridgeChecker: vi.fn(() => ({})),
  ChannelChecker: vi.fn(() => ({})),
  VaultChecker: vi.fn(() => ({})),
  SessionChecker: vi.fn(() => ({})),
  MemoryChecker: vi.fn(() => ({})),
}));
vi.mock("../../src/cli/executor.js", () => ({ CliExecutor: vi.fn(() => ({})) }));
vi.mock("../../src/cli/registry.js", () => ({
  CliToolRegistry: vi.fn(() => ({
    getManifest: vi.fn(() => ({})),
    listTools: vi.fn(() => []),
  })),
}));
vi.mock("../../src/gateway/security-wiring.js", () => ({
  initSecurity: vi.fn(() => ({
    pairingStore: {},
    allowlistStore: {},
    rateLimiter: {},
    securityGate: {},
  })),
}));
vi.mock("../../src/gateway/intelligence-wiring.js", () => ({
  initIntelligence: vi.fn(() => ({
    intelligenceBus: { dispose: vi.fn(), emit: vi.fn() },
    intelligenceStore: {},
    inferenceEngine: null,
    triggerEvaluator: {},
    outcomeAnalyzer: { recordEngagement: vi.fn() },
    arcDetector: { processMemory: vi.fn() },
    arcLifecycle: {},
    goalLifecycle: {},
    crossChannelResolver: {},
    trendDetector: null,
    healthGate: null,
    promptAssembler: {},
  })),
}));
vi.mock("../../src/gateway/adapters.js", () => ({
  startChannelAdapters: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/gateway/shutdown.js", () => ({
  registerShutdownHandlers: vi.fn(),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as typeof import("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn(() => '{"model":"openrouter/meta-llama/llama-3.3-70b-instruct:free","small_model":"none"}'),
    writeFileSync: vi.fn(),
  };
});

// ─── Minimal config factory ────────────────────────────────────────────────────

function makeMinimalConfig(overrides: Record<string, any> = {}) {
  return {
    logging: { level: "silent" },
    opencode: { port: 4096, projectDir: "/tmp/test-oc" },
    security: {
      defaultDmPolicy: "open",
      pairingCodeTtlMs: 300000,
      pairingCodeLength: 6,
      rateLimitPerMinute: 20,
      rateLimitPerHour: 200,
    },
    governance: { enabled: false, rules: [], directives: [] },
    policy: {
      enabled: false,
      tools: { allowed: [], denied: [] },
      permissions: { bash: "deny", edit: "deny", read: "deny" },
      agents: { allowedModes: ["subagent"], maxSteps: 0, requireDescription: true, defaultTools: [], allowPrimaryCreation: false },
      skills: { restricted: [], requireTriggers: false },
      enforcement: { blockUnknownTools: true, auditPolicyViolations: true },
    },
    channels: {},
    gateway: { port: 19876, hostname: "127.0.0.1" },
    ...overrides,
  };
}

// ─── Mock bridge factory ───────────────────────────────────────────────────────

function makeBridgeMock() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue({ id: "warmup-sess-1" }),
    sendMessage: vi.fn().mockResolvedValue("pong"),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getInFlightCount: vi.fn().mockReturnValue(0),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("startGateway()", () => {
  let loadConfig: any;
  let createLogger: any;
  let OpenCodeBridge: any;
  let bridgeMock: any;
  let loggerMock: any;

  beforeEach(async () => {
    const loaderMod = await import("../../src/config/loader.js");
    const loggerMod = await import("../../src/logging/logger.js");
    const bridgeMod = await import("../../src/bridge/opencode-client.js");

    loadConfig = vi.mocked(loaderMod.loadConfig);
    createLogger = vi.mocked(loggerMod.createLogger);
    OpenCodeBridge = vi.mocked(bridgeMod.OpenCodeBridge);

    loggerMock = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    };

    bridgeMock = makeBridgeMock();
    createLogger.mockReturnValue(loggerMock);
    OpenCodeBridge.mockImplementation(() => bridgeMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Restore any spies (e.g. console.log, Date.now)
    vi.restoreAllMocks();
  });

  it("returns a GatewayContext with all required fields", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    const ctx = await startGateway();

    expect(ctx).toBeDefined();
    expect(ctx.config).toBeDefined();
    expect(ctx.logger).toBeDefined();
    expect(ctx.bridge).toBeDefined();
    expect(ctx.toolServer).toBeDefined();
    expect(ctx.healthServer).toBeDefined();
    expect(ctx.registry).toBeDefined();
    expect(ctx.sessionMap).toBeDefined();
    expect(ctx.vaultStore).toBeDefined();
    expect(ctx.vaultDb).toBeDefined();
    expect(ctx.abortController).toBeDefined();
    expect(ctx.pluginRegistry).toBeDefined();
  });

  it("calls bridge.start() during initialization", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();
    expect(bridgeMock.start).toHaveBeenCalledTimes(1);
  });

  it("warms up OpenCode bridge before proceeding", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();
    expect(bridgeMock.checkHealth).toHaveBeenCalled();
    expect(bridgeMock.createSession).toHaveBeenCalledWith("__readiness_check__");
    expect(bridgeMock.sendMessage).toHaveBeenCalledWith("warmup-sess-1", "ping");
    expect(bridgeMock.deleteSession).toHaveBeenCalledWith("warmup-sess-1");
  });

  it("logs OpenCode ready when warmup succeeds", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();
    expect(loggerMock.info).toHaveBeenCalledWith("OpenCode ready (providers warmed up)");
  });

  it("logs warmup timeout warning when bridge never becomes healthy", async () => {
    bridgeMock.checkHealth = vi.fn().mockResolvedValue(false); // never healthy
    OpenCodeBridge.mockImplementation(() => bridgeMock);

    // Make the while loop exit on first condition check by returning a time
    // beyond the 60s READY_TIMEOUT_MS on the second Date.now() call.
    const fixedStart = 1_000_000;
    let nowCall = 0;
    const origNow = Date.now;
    Date.now = () => {
      nowCall++;
      return nowCall === 1 ? fixedStart : fixedStart + 70_000;
    };

    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    Date.now = origNow;

    expect(loggerMock.warn).toHaveBeenCalledWith(
      "OpenCode warmup timed out — providers may not be ready",
    );
  });

  it("returns intentStore as null when proactive is disabled", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig({ proactive: { enabled: false } }));
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    const ctx = await startGateway();
    expect(ctx.intentStore).toBeNull();
    expect(ctx.pulseEngine).toBeNull();
  });

  it("creates intentStore when proactive is enabled", async () => {
    const { IntentStore } = await import("../../src/proactive/store.js");
    const { PulseEngine } = await import("../../src/proactive/engine.js");
    vi.mocked(IntentStore).mockImplementation(() => ({ addIntent: vi.fn() }) as any);
    vi.mocked(PulseEngine).mockImplementation(() => ({ start: vi.fn(), stop: vi.fn() }) as any);

    loadConfig.mockReturnValue(makeMinimalConfig({
      proactive: { enabled: true, checkIntervalMs: 60000, quietHours: null, maxDailyMessages: 5 },
    }));
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    const ctx = await startGateway();
    expect(ctx.intentStore).not.toBeNull();
    expect(ctx.pulseEngine).not.toBeNull();
  });

  it("returns heartbeatEngine as null when heartbeat is disabled", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig({ heartbeat: { enabled: false } }));
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    const ctx = await startGateway();
    expect(ctx.heartbeatEngine).toBeNull();
    expect(ctx.activityTracker).toBeNull();
  });

  it("creates HeartbeatEngine when heartbeat is enabled", async () => {
    const { HeartbeatEngine } = await import("../../src/heartbeat/engine.js");
    const { HeartbeatStore } = await import("../../src/heartbeat/store.js");
    const { ActivityTracker } = await import("../../src/heartbeat/activity.js");
    const heartbeatEngineMock = { start: vi.fn(), stop: vi.fn() };
    vi.mocked(HeartbeatEngine).mockImplementation(() => heartbeatEngineMock as any);
    vi.mocked(HeartbeatStore).mockImplementation(() => ({}) as any);
    vi.mocked(ActivityTracker).mockImplementation(() => ({ recordMessage: vi.fn() }) as any);

    loadConfig.mockReturnValue(makeMinimalConfig({
      heartbeat: {
        enabled: true,
        intervalMs: 60000,
        agentId: "default",
        alertThreshold: 3,
        alertCooldownMs: 300000,
        activeHours: null,
      },
    }));
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    const ctx = await startGateway();
    expect(ctx.heartbeatEngine).not.toBeNull();
    expect(heartbeatEngineMock.start).toHaveBeenCalledTimes(1);
  });

  it("returns signalStore and profileEnricher as null when onboarding is disabled", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig({ onboarding: { enabled: false } }));
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    const ctx = await startGateway();
    expect(ctx.signalStore).toBeNull();
    expect(ctx.profileEnricher).toBeNull();
  });

  it("initializes onboarding when enabled", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig({
      onboarding: {
        enabled: true,
        enricher: { consolidateIntervalMs: 3600000 },
        languageDetection: { enabled: true },
      },
    }));
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    const ctx = await startGateway();
    expect(ctx.signalStore).not.toBeNull();
    expect(ctx.profileEnricher).not.toBeNull();
  });

  it("emits gateway.ready hook after startup", async () => {
    const hookBus = { emit: vi.fn().mockResolvedValue(undefined) };
    const { PluginLoader } = await import("../../src/plugins/loader.js");
    vi.mocked(PluginLoader).mockImplementation(() => ({
      loadAll: vi.fn().mockResolvedValue({
        tools: [],
        services: new Map(),
        channels: new Map(),
        hookBus,
      }),
    }) as any);

    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    expect(hookBus.emit).toHaveBeenCalledWith("gateway.ready", expect.anything());
  });

  it("calls registerShutdownHandlers after startup", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig());
    const { registerShutdownHandlers } = await import("../../src/gateway/shutdown.js");
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();
    expect(vi.mocked(registerShutdownHandlers)).toHaveBeenCalledTimes(1);
  });

  it("starts plugin services from pluginRegistry", async () => {
    const svcA = { start: vi.fn().mockResolvedValue(undefined) };
    const svcB = { start: vi.fn().mockResolvedValue(undefined) };
    const { PluginLoader } = await import("../../src/plugins/loader.js");
    vi.mocked(PluginLoader).mockImplementation(() => ({
      loadAll: vi.fn().mockResolvedValue({
        tools: [],
        services: new Map([["svc-a", svcA], ["svc-b", svcB]]),
        channels: new Map(),
        hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
      }),
    }) as any);

    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    expect(svcA.start).toHaveBeenCalledTimes(1);
    expect(svcB.start).toHaveBeenCalledTimes(1);
  });

  it("handles plugin service start failure gracefully", async () => {
    const faultySvc = { start: vi.fn().mockRejectedValue(new Error("service boom")) };
    const { PluginLoader } = await import("../../src/plugins/loader.js");
    vi.mocked(PluginLoader).mockImplementation(() => ({
      loadAll: vi.fn().mockResolvedValue({
        tools: [],
        services: new Map([["faulty", faultySvc]]),
        channels: new Map(),
        hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
      }),
    }) as any);

    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    // Should not throw
    const ctx = await startGateway();
    expect(ctx).toBeDefined();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ service: "faulty" }),
      "Failed to start plugin service",
    );
  });

  it("prints startup summary (covers console.log lines)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();
    // readFileSync is mocked to return valid JSON, so startup summary should print
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Gateway Ready"));
    consoleSpy.mockRestore();
  });

  it("handles startup summary failure gracefully (best-effort)", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("file not found");
    });

    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    // Should not throw even if readFileSync fails
    const ctx = await startGateway();
    expect(ctx).toBeDefined();
  });

  it("initializes CLI tools when cli is enabled", async () => {
    const { CliToolRegistry } = await import("../../src/cli/registry.js");
    const { CliExecutor } = await import("../../src/cli/executor.js");
    const { writeFileSync } = await import("node:fs");

    loadConfig.mockReturnValue(makeMinimalConfig({
      cli: {
        enabled: true,
        timeout: 30000,
        tools: [],
        sandbox: { allowedBinaries: ["echo"] },
      },
    }));
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    expect(vi.mocked(CliToolRegistry)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(CliExecutor)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
  });

  it("enables auto-reply template engine when configured", async () => {
    const { TemplateEngine } = await import("../../src/auto-reply/engine.js");

    loadConfig.mockReturnValue(makeMinimalConfig({
      autoReply: {
        enabled: true,
        templates: [
          {
            id: "greet",
            trigger: { type: "keyword", value: "hello" },
            response: "Hi!",
            priority: 1,
            cooldown: 0,
            once: false,
            channels: [],
            chatTypes: [],
            forwardToAi: false,
          },
        ],
      },
    }));
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    expect(vi.mocked(TemplateEngine)).toHaveBeenCalledTimes(1);
  });

  it("logs 'Iris gateway started' at the end of startup", async () => {
    loadConfig.mockReturnValue(makeMinimalConfig());
    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();
    expect(loggerMock.info).toHaveBeenCalledWith("Iris gateway started");
  });
});
