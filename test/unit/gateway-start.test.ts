/**
 * Unit tests for startGateway() in src/gateway/lifecycle.ts.
 * Uses vi.mock() to isolate from real I/O, network, and file system.
 * Covers lines 90–387 of lifecycle.ts (issue #107).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// ─── Mock all heavy dependencies before any imports ───────────────────────────

vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../src/config/paths.js", () => ({
  getStateDir: vi.fn().mockReturnValue("/tmp/iris-test-state"),
  ensureDir: vi.fn().mockImplementation((d: string) => d),
}));

vi.mock("../../src/logging/logger.js", () => ({
  createLogger: vi.fn(),
}));

vi.mock("../../src/bridge/opencode-client.js", () => ({
  OpenCodeBridge: vi.fn(),
}));

vi.mock("../../src/bridge/session-map.js", () => ({
  SessionMap: vi.fn(),
}));

vi.mock("../../src/bridge/message-router.js", () => ({
  MessageRouter: vi.fn(),
}));

vi.mock("../../src/bridge/tool-server.js", () => ({
  ToolServer: vi.fn(),
}));

vi.mock("../../src/channels/registry.js", () => ({
  ChannelRegistry: vi.fn(),
}));

vi.mock("../../src/channels/message-cache.js", () => ({
  MessageCache: vi.fn(),
}));

vi.mock("../../src/vault/db.js", () => ({
  VaultDB: vi.fn(),
}));

vi.mock("../../src/vault/store.js", () => ({
  VaultStore: vi.fn(),
}));

vi.mock("../../src/vault/search.js", () => ({
  VaultSearch: vi.fn(),
}));

vi.mock("../../src/governance/engine.js", () => ({
  GovernanceEngine: vi.fn(),
}));

vi.mock("../../src/governance/policy.js", () => ({
  PolicyEngine: vi.fn(),
}));

vi.mock("../../src/plugins/loader.js", () => ({
  PluginLoader: vi.fn(),
}));

vi.mock("../../src/auto-reply/engine.js", () => ({
  TemplateEngine: vi.fn(),
}));

vi.mock("../../src/usage/tracker.js", () => ({
  UsageTracker: vi.fn(),
}));

vi.mock("../../src/canvas/server.js", () => ({
  CanvasServer: vi.fn(),
}));

vi.mock("../../src/gateway/health.js", () => ({
  HealthServer: vi.fn(),
}));

vi.mock("../../src/onboarding/signals.js", () => ({
  SignalStore: vi.fn(),
}));

vi.mock("../../src/onboarding/enricher.js", () => ({
  ProfileEnricher: vi.fn(),
}));

vi.mock("../../src/cli/executor.js", () => ({
  CliExecutor: vi.fn(),
}));

vi.mock("../../src/cli/registry.js", () => ({
  CliToolRegistry: vi.fn(),
}));

vi.mock("../../src/gateway/security-wiring.js", () => ({
  initSecurity: vi.fn(),
}));

vi.mock("../../src/gateway/intelligence-bootstrap.js", () => ({
  bootstrapIntelligence: vi.fn(),
}));
vi.mock("../../src/gateway/proactive-bootstrap.js", () => ({
  bootstrapProactive: vi.fn(),
  startPulseEngine: vi.fn(),
}));
vi.mock("../../src/gateway/heartbeat-bootstrap.js", () => ({
  bootstrapHeartbeat: vi.fn(),
  startHeartbeatEngine: vi.fn(),
}));

vi.mock("../../src/gateway/adapters.js", () => ({
  startChannelAdapters: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/gateway/shutdown.js", () => ({
  registerShutdownHandlers: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue('{"model":"gpt-4","small_model":"gpt-4-mini"}'),
  writeFileSync: vi.fn(),
}));

// ─── Now import after mocks are set up ───────────────────────────────────────

import { startGateway } from "../../src/gateway/lifecycle.js";
import { loadConfig } from "../../src/config/loader.js";
import { createLogger } from "../../src/logging/logger.js";
import { OpenCodeBridge } from "../../src/bridge/opencode-client.js";
import { SessionMap } from "../../src/bridge/session-map.js";
import { MessageRouter } from "../../src/bridge/message-router.js";
import { ToolServer } from "../../src/bridge/tool-server.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { MessageCache } from "../../src/channels/message-cache.js";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";
import { VaultSearch } from "../../src/vault/search.js";
import { GovernanceEngine } from "../../src/governance/engine.js";
import { PolicyEngine } from "../../src/governance/policy.js";
import { PluginLoader } from "../../src/plugins/loader.js";
import { UsageTracker } from "../../src/usage/tracker.js";
import { HealthServer } from "../../src/gateway/health.js";
import { initSecurity } from "../../src/gateway/security-wiring.js";
import { bootstrapIntelligence } from "../../src/gateway/intelligence-bootstrap.js";
import { bootstrapProactive, startPulseEngine } from "../../src/gateway/proactive-bootstrap.js";
import { bootstrapHeartbeat, startHeartbeatEngine } from "../../src/gateway/heartbeat-bootstrap.js";
import { startChannelAdapters } from "../../src/gateway/adapters.js";
import { registerShutdownHandlers } from "../../src/gateway/shutdown.js";
import { SignalStore } from "../../src/onboarding/signals.js";
import { ProfileEnricher } from "../../src/onboarding/enricher.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeBridge() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
    sendMessage: vi.fn().mockResolvedValue("pong"),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getInFlightCount: vi.fn().mockReturnValue(0),
  };
}

function makePluginRegistry() {
  return {
    tools: [],
    services: new Map(),
    hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
  };
}

function makeGovernanceEngine() {
  return { getRules: vi.fn().mockReturnValue([]) };
}

function makePolicyEngine() {
  return { enabled: false };
}

function makeToolServer() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    setHeartbeatEngine: vi.fn(),
  };
}

function makeHealthServer() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function makeIntelligence() {
  return {
    intelligenceBus: null,
    intelligenceStore: null,
    inferenceEngine: null,
    triggerEvaluator: null,
    outcomeAnalyzer: null,
    arcDetector: null,
    arcLifecycle: null,
    goalLifecycle: null,
    crossChannelResolver: null,
    healthGate: null,
    promptAssembler: null,
    trendDetector: null,
  };
}

function makeSecurity() {
  return {
    pairingStore: {},
    allowlistStore: {},
    rateLimiter: {},
    securityGate: {},
  };
}

function makeMinimalConfig(overrides: Record<string, any> = {}): any {
  return {
    opencode: { port: 9000, projectDir: "/tmp", host: "localhost" },
    gateway: { port: 19876, hostname: "0.0.0.0" },
    logging: { level: "info" },
    channels: { telegram: { token: "test-token", secret: "sec" } },
    security: {
      defaultDmPolicy: "open",
      pairingCodeTtlMs: 60000,
      pairingCodeLength: 6,
      rateLimitPerMinute: 60,
      rateLimitPerHour: 360,
    },
    governance: { enabled: false, rules: [], directives: [] },
    policy: { enabled: false },
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  const logger = makeLogger();
  const bridge = makeBridge();
  const pluginRegistry = makePluginRegistry();

  vi.mocked(loadConfig).mockReturnValue(makeMinimalConfig());
  vi.mocked(createLogger).mockReturnValue(logger as any);
  vi.mocked(OpenCodeBridge).mockImplementation(() => bridge as any);
  vi.mocked(SessionMap).mockImplementation(() => ({}) as any);
  vi.mocked(MessageRouter).mockImplementation(() => ({ dispose: vi.fn() }) as any);
  vi.mocked(ToolServer).mockImplementation(() => makeToolServer() as any);
  vi.mocked(ChannelRegistry).mockImplementation(() => ({ register: vi.fn(), get: vi.fn(), list: vi.fn().mockReturnValue([]) }) as any);
  vi.mocked(MessageCache).mockImplementation(() => ({ dispose: vi.fn() }) as any);
  vi.mocked(VaultDB).mockImplementation(() => ({
    close: vi.fn(),
    raw: vi.fn().mockReturnValue(new Database(':memory:'))
  }) as any);
  vi.mocked(VaultStore).mockImplementation(() => ({}) as any);
  vi.mocked(VaultSearch).mockImplementation(() => ({}) as any);
  vi.mocked(GovernanceEngine).mockImplementation(() => makeGovernanceEngine() as any);
  vi.mocked(PolicyEngine).mockImplementation(() => makePolicyEngine() as any);
  vi.mocked(PluginLoader).mockImplementation(() => ({
    loadAll: vi.fn().mockResolvedValue(pluginRegistry),
  }) as any);
  vi.mocked(UsageTracker).mockImplementation(() => ({}) as any);
  vi.mocked(SignalStore).mockImplementation(() => ({}) as any);
  vi.mocked(ProfileEnricher).mockImplementation(() => ({}) as any);
  vi.mocked(HealthServer).mockImplementation(() => makeHealthServer() as any);
  vi.mocked(initSecurity).mockReturnValue(makeSecurity() as any);
  vi.mocked(bootstrapIntelligence).mockReturnValue(makeIntelligence() as any);
  vi.mocked(bootstrapProactive).mockImplementation((config: any) => ({
    intentStore: config.proactive?.enabled ? {} : null,
  }));
  vi.mocked(startPulseEngine).mockImplementation((config: any, _logger: any, intentStore: any) => (
    config.proactive?.enabled && intentStore
      ? { start: vi.fn(), stop: vi.fn() }
      : null
  ));
  vi.mocked(bootstrapHeartbeat).mockImplementation((config: any) => ({
    heartbeatStore: config.heartbeat?.enabled ? {} : null,
    activityTracker: config.heartbeat?.enabled ? {} : null,
  }));
  vi.mocked(startHeartbeatEngine).mockImplementation((config: any, _logger: any, heartbeatStore: any, toolServer: any) => {
    if (!(config.heartbeat?.enabled && heartbeatStore)) return null;
    const engine = { start: vi.fn(), stop: vi.fn(), getStatus: vi.fn().mockReturnValue([]) };
    toolServer.setHeartbeatEngine(engine);
    return engine;
  });
  vi.mocked(startChannelAdapters).mockResolvedValue(undefined);
  vi.mocked(registerShutdownHandlers).mockImplementation(() => {});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("startGateway", () => {
  it("returns a GatewayContext with all required fields", async () => {
    const ctx = await startGateway();
    expect(ctx).toBeDefined();
    expect(ctx.config).toBeDefined();
    expect(ctx.logger).toBeDefined();
    expect(ctx.bridge).toBeDefined();
    expect(ctx.sessionMap).toBeDefined();
    expect(ctx.router).toBeDefined();
    expect(ctx.toolServer).toBeDefined();
    expect(ctx.healthServer).toBeDefined();
    expect(ctx.registry).toBeDefined();
    expect(ctx.vaultDb).toBeDefined();
    expect(ctx.vaultStore).toBeDefined();
    expect(ctx.governanceEngine).toBeDefined();
    expect(ctx.abortController).toBeInstanceOf(AbortController);
  });

  it("calls loadConfig with provided configPath", async () => {
    await startGateway("/custom/config.yaml");
    expect(loadConfig).toHaveBeenCalledWith("/custom/config.yaml");
  });

  it("calls loadConfig with undefined when no path given", async () => {
    await startGateway();
    expect(loadConfig).toHaveBeenCalledWith(undefined);
  });

  it("starts the OpenCode bridge", async () => {
    const bridge = makeBridge();
    vi.mocked(OpenCodeBridge).mockImplementation(() => bridge as any);
    await startGateway();
    expect(bridge.start).toHaveBeenCalled();
  });

  it("starts the tool server", async () => {
    const toolServer = makeToolServer();
    vi.mocked(ToolServer).mockImplementation(() => toolServer as any);
    await startGateway();
    expect(toolServer.start).toHaveBeenCalled();
  });

  it("starts the health server", async () => {
    const healthServer = makeHealthServer();
    vi.mocked(HealthServer).mockImplementation(() => healthServer as any);
    await startGateway();
    expect(healthServer.start).toHaveBeenCalled();
  });

  it("calls startChannelAdapters", async () => {
    await startGateway();
    expect(startChannelAdapters).toHaveBeenCalled();
  });

  it("calls registerShutdownHandlers", async () => {
    await startGateway();
    expect(registerShutdownHandlers).toHaveBeenCalled();
  });

  it("bridge warmup: stops polling when checkHealth returns true — no session or message created", async () => {
    const bridge = makeBridge();
    vi.mocked(OpenCodeBridge).mockImplementation(() => bridge as any);
    await startGateway();
    expect(bridge.checkHealth).toHaveBeenCalled();
    expect(bridge.createSession).not.toHaveBeenCalled();
    expect(bridge.sendMessage).not.toHaveBeenCalled();
    expect(bridge.deleteSession).not.toHaveBeenCalled();
  });

  it("initializes intentStore when proactive.enabled=true", async () => {
    vi.mocked(loadConfig).mockReturnValue(makeMinimalConfig({ proactive: { enabled: true, rules: [] } }));
    const ctx = await startGateway();
    expect(ctx.intentStore).not.toBeNull();
  });

  it("intentStore is null when proactive is disabled", async () => {
    vi.mocked(loadConfig).mockReturnValue(makeMinimalConfig({ proactive: { enabled: false } }));
    const ctx = await startGateway();
    expect(ctx.intentStore).toBeNull();
  });

  it("initializes signalStore and profileEnricher when onboarding.enabled=true", async () => {
    vi.mocked(loadConfig).mockReturnValue(makeMinimalConfig({
      onboarding: {
        enabled: true,
        enricher: { consolidateIntervalMs: 600000 },
      },
    }));
    const signalStore = {};
    const profileEnricher = {};
    vi.mocked(SignalStore).mockImplementation(() => signalStore as any);
    vi.mocked(ProfileEnricher).mockImplementation(() => profileEnricher as any);
    const ctx = await startGateway();
    expect(ctx.signalStore).toBe(signalStore);
    expect(ctx.profileEnricher).toBe(profileEnricher);
  });

  it("signalStore is null when onboarding is disabled", async () => {
    const ctx = await startGateway();
    expect(ctx.signalStore).toBeNull();
    expect(ctx.profileEnricher).toBeNull();
  });

  it("initializes heartbeat components when heartbeat.enabled=true", async () => {
    const heartbeatConfig = {
      enabled: true,
      intervalMs: 30000,
      components: [],
      agentId: "main",
    };
    vi.mocked(loadConfig).mockReturnValue(makeMinimalConfig({ heartbeat: heartbeatConfig }));

    const toolServer = makeToolServer();
    vi.mocked(ToolServer).mockImplementation(() => toolServer as any);

    const ctx = await startGateway();
    expect(ctx.heartbeatEngine).not.toBeNull();
    expect(ctx.activityTracker).not.toBeNull();
    expect(toolServer.setHeartbeatEngine).toHaveBeenCalledWith(ctx.heartbeatEngine);
  });

  it("heartbeatEngine is null when heartbeat is disabled", async () => {
    const ctx = await startGateway();
    expect(ctx.heartbeatEngine).toBeNull();
  });

  it("starts proactive pulse engine when proactive.enabled=true and intentStore initialized", async () => {
    vi.mocked(loadConfig).mockReturnValue(makeMinimalConfig({
      proactive: {
        enabled: true,
        pulseIntervalMs: 60000,
        maxIntentsPerHour: 10,
        rules: [],
      },
    }));
    const ctx = await startGateway();
    expect(ctx.pulseEngine).not.toBeNull();
  });

  it("plugin services are started during gateway init", async () => {
    const logger = makeLogger();
    vi.mocked(createLogger).mockReturnValue(logger as any);
    const svc = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
    const pluginRegistry = {
      tools: [],
      services: new Map([["test-svc", svc]]),
      hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
    };
    vi.mocked(PluginLoader).mockImplementation(() => ({
      loadAll: vi.fn().mockResolvedValue(pluginRegistry),
    }) as any);

    await startGateway();
    expect(svc.start).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ service: "test-svc" }), "Plugin service started");
  });

  it("plugin service start failure is logged but does not crash gateway", async () => {
    const logger = makeLogger();
    vi.mocked(createLogger).mockReturnValue(logger as any);
    const faultySvc = { start: vi.fn().mockRejectedValue(new Error("svc boom")), stop: vi.fn() };
    const pluginRegistry = {
      tools: [],
      services: new Map([["broken-svc", faultySvc]]),
      hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
    };
    vi.mocked(PluginLoader).mockImplementation(() => ({
      loadAll: vi.fn().mockResolvedValue(pluginRegistry),
    }) as any);

    const ctx = await startGateway();
    expect(ctx).toBeDefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ service: "broken-svc" }),
      "Failed to start plugin service",
    );
  });

  it("emits gateway.ready hook after all components start", async () => {
    const hookBus = { emit: vi.fn().mockResolvedValue(undefined) };
    const pluginRegistry = { tools: [], services: new Map(), hookBus };
    vi.mocked(PluginLoader).mockImplementation(() => ({
      loadAll: vi.fn().mockResolvedValue(pluginRegistry),
    }) as any);

    await startGateway();
    expect(hookBus.emit).toHaveBeenCalledWith("gateway.ready", undefined);
  });

  it("returns null intentStore and pulseEngine when proactive is not configured", async () => {
    const ctx = await startGateway();
    expect(ctx.intentStore).toBeNull();
    expect(ctx.pulseEngine).toBeNull();
  });

  it("logs startup summary from opencode.json (best-effort)", async () => {
    const logger = makeLogger();
    vi.mocked(createLogger).mockReturnValue(logger as any);
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue('{"model":"claude-3","small_model":"gpt-mini"}');
    await startGateway();
    // Gateway reads .opencode/opencode.json and logs — verify no crash
    expect(logger.info).toHaveBeenCalledWith("Iris gateway started");
  });

  it("handles missing opencode.json gracefully (best-effort block)", async () => {
    const logger = makeLogger();
    vi.mocked(createLogger).mockReturnValue(logger as any);
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error("ENOENT"); });
    // Should not throw — the try/catch in lifecycle.ts handles it
    const ctx = await startGateway();
    expect(ctx).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith("Iris gateway started");
  });

  it("bootstrapIntelligence is called with correct arguments", async () => {
    await startGateway();
    expect(bootstrapIntelligence).toHaveBeenCalledWith(
      expect.anything(), // bridge
      expect.anything(), // vaultDb
      null,              // signalStore (onboarding disabled)
      null,              // intentStore (proactive disabled)
      null,              // heartbeatStore (heartbeat disabled)
      expect.anything(), // logger
    );
  });

  it("initSecurity is called with config and stateDir", async () => {
    await startGateway();
    expect(initSecurity).toHaveBeenCalledWith(
      expect.objectContaining({ security: expect.any(Object) }),
      "/tmp/iris-test-state",
    );
  });

  it("policy engine enabled path: logs when policyEngine.enabled=true", async () => {
    const logger = makeLogger();
    vi.mocked(createLogger).mockReturnValue(logger as any);
    vi.mocked(PolicyEngine).mockImplementation(() => ({ enabled: true }) as any);
    await startGateway();
    expect(logger.info).toHaveBeenCalledWith("Master policy engine enabled");
  });
});
