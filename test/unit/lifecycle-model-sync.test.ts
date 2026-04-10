/**
 * Unit tests for the OpenRouter model-sync block in src/gateway/lifecycle.ts
 * Targets lines ~136-340 (model registration) and ~340-380 (agent frontmatter sync).
 * Issue #174 — lifts function coverage from 25% toward >= 70% floor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

// ─── Module mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../../src/config/loader.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/config/paths.js", () => ({
  getStateDir: vi.fn(() => "/tmp/test-state"),
  ensureDir: vi.fn((p: string) => p),
}));
vi.mock("../../src/logging/logger.js", () => ({ createLogger: vi.fn() }));
vi.mock("../../src/bridge/opencode-client.js", () => ({ OpenCodeBridge: vi.fn() }));
vi.mock("../../src/bridge/session-map.js", () => ({ SessionMap: vi.fn() }));
vi.mock("../../src/bridge/message-router.js", () => ({ MessageRouter: vi.fn() }));
vi.mock("../../src/bridge/tool-server.js", () => ({ ToolServer: vi.fn() }));
vi.mock("../../src/channels/registry.js", () => ({ ChannelRegistry: vi.fn() }));
vi.mock("../../src/channels/message-cache.js", () => ({ MessageCache: vi.fn() }));
vi.mock("../../src/vault/db.js", () => ({ VaultDB: vi.fn() }));
vi.mock("../../src/vault/store.js", () => ({ VaultStore: vi.fn() }));
vi.mock("../../src/vault/search.js", () => ({ VaultSearch: vi.fn() }));
vi.mock("../../src/governance/engine.js", () => ({ GovernanceEngine: vi.fn() }));
vi.mock("../../src/governance/policy.js", () => ({ PolicyEngine: vi.fn() }));
vi.mock("../../src/plugins/loader.js", () => ({ PluginLoader: vi.fn() }));
vi.mock("../../src/auto-reply/engine.js", () => ({ TemplateEngine: vi.fn() }));
vi.mock("../../src/usage/tracker.js", () => ({ UsageTracker: vi.fn() }));
vi.mock("../../src/proactive/store.js", () => ({ IntentStore: vi.fn() }));
vi.mock("../../src/proactive/engine.js", () => ({ PulseEngine: vi.fn() }));
vi.mock("../../src/canvas/server.js", () => ({ CanvasServer: vi.fn() }));
vi.mock("../../src/gateway/health.js", () => ({ HealthServer: vi.fn() }));
vi.mock("../../src/onboarding/signals.js", () => ({ SignalStore: vi.fn() }));
vi.mock("../../src/onboarding/enricher.js", () => ({ ProfileEnricher: vi.fn() }));
vi.mock("../../src/heartbeat/store.js", () => ({ HeartbeatStore: vi.fn() }));
vi.mock("../../src/heartbeat/engine.js", () => ({ HeartbeatEngine: vi.fn() }));
vi.mock("../../src/heartbeat/activity.js", () => ({ ActivityTracker: vi.fn() }));
vi.mock("../../src/heartbeat/checkers.js", () => ({
  BridgeChecker: vi.fn(),
  ChannelChecker: vi.fn(),
  VaultChecker: vi.fn(),
  SessionChecker: vi.fn(),
  MemoryChecker: vi.fn(),
}));
vi.mock("../../src/cli/executor.js", () => ({ CliExecutor: vi.fn() }));
vi.mock("../../src/instance/coordinator.js", () => ({ InstanceCoordinator: vi.fn() }));
vi.mock("../../src/cli/registry.js", () => ({ CliToolRegistry: vi.fn() }));
vi.mock("../../src/gateway/security-wiring.js", () => ({
  initSecurity: vi.fn(),
}));
vi.mock("../../src/gateway/intelligence-wiring.js", () => ({
  initIntelligence: vi.fn(),
}));
vi.mock("../../src/gateway/adapters.js", () => ({
  startChannelAdapters: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/gateway/shutdown.js", () => ({
  registerShutdownHandlers: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_DIR = "/tmp/test-project";
const OC_PATH = `${PROJECT_DIR}/.opencode/opencode.json`;
const AGENT_DIR = `${PROJECT_DIR}/.opencode/agent`;

/** Minimal iris.config.json shape that triggers model sync */
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    opencode: { projectDir: PROJECT_DIR, port: 4000 },
    gateway: { port: 3000, hostname: "localhost" },
    logging: { level: "error" },
    channels: {},
    models: { primary: "openrouter/test-provider/some-model", small: "openrouter/test-provider/small-model" },
    ...overrides,
  };
}

/** Minimal opencode.json content */
function makeOcConfig(overrides: Record<string, unknown> = {}) {
  return {
    model: "old-model",
    small_model: "old-small",
    provider: {},
    ...overrides,
  };
}

/** Wire all module mocks so startGateway() can run without crashing */
async function wireAllMocks() {
  const { loadConfig } = await import("../../src/config/loader.js");
  const { createLogger } = await import("../../src/logging/logger.js");
  const { OpenCodeBridge } = await import("../../src/bridge/opencode-client.js");
  const { SessionMap } = await import("../../src/bridge/session-map.js");
  const { MessageRouter } = await import("../../src/bridge/message-router.js");
  const { ToolServer } = await import("../../src/bridge/tool-server.js");
  const { ChannelRegistry } = await import("../../src/channels/registry.js");
  const { MessageCache } = await import("../../src/channels/message-cache.js");
  const { VaultDB } = await import("../../src/vault/db.js");
  const { VaultStore } = await import("../../src/vault/store.js");
  const { VaultSearch } = await import("../../src/vault/search.js");
  const { GovernanceEngine } = await import("../../src/governance/engine.js");
  const { PolicyEngine } = await import("../../src/governance/policy.js");
  const { PluginLoader } = await import("../../src/plugins/loader.js");
  const { UsageTracker } = await import("../../src/usage/tracker.js");
  const { InstanceCoordinator } = await import("../../src/instance/coordinator.js");
  const { HealthServer } = await import("../../src/gateway/health.js");
  const { initSecurity } = await import("../../src/gateway/security-wiring.js");
  const { initIntelligence } = await import("../../src/gateway/intelligence-wiring.js");
  const { startChannelAdapters } = await import("../../src/gateway/adapters.js");

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  const bridge = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue({ id: "readiness-sess" }),
    sendMessage: vi.fn().mockResolvedValue("pong"),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getInFlightCount: vi.fn().mockReturnValue(0),
  };

  const pluginRegistry = {
    tools: [],
    services: new Map(),
    hookBus: { emit: vi.fn().mockResolvedValue(undefined) },
  };

  vi.mocked(loadConfig).mockReturnValue(makeConfig() as any);
  vi.mocked(createLogger).mockReturnValue(logger as any);
  vi.mocked(OpenCodeBridge).mockImplementation(() => bridge as any);
  vi.mocked(SessionMap).mockImplementation(() => ({ dispose: vi.fn() } as any));
  vi.mocked(MessageRouter).mockImplementation(() => ({
    dispose: vi.fn(),
    getEventHandler: vi.fn().mockReturnValue({ handleEvent: vi.fn() }),
  } as any));
  vi.mocked(ToolServer).mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    setHeartbeatEngine: vi.fn(),
  } as any));
  vi.mocked(ChannelRegistry).mockImplementation(() => ({
    register: vi.fn(), get: vi.fn(), list: vi.fn().mockReturnValue([]),
  } as any));
  vi.mocked(MessageCache).mockImplementation(() => ({ dispose: vi.fn() } as any));
  vi.mocked(VaultDB).mockImplementation(() => ({
    close: vi.fn(),
    raw: vi.fn().mockReturnValue({}),
    prepare: vi.fn().mockReturnValue({ run: vi.fn(), all: vi.fn().mockReturnValue([]), get: vi.fn() }),
  } as any));
  vi.mocked(VaultStore).mockImplementation(() => ({} as any));
  vi.mocked(VaultSearch).mockImplementation(() => ({} as any));
  vi.mocked(GovernanceEngine).mockImplementation(() => ({
    getRules: vi.fn().mockReturnValue([]),
  } as any));
  vi.mocked(PolicyEngine).mockImplementation(() => ({ enabled: false } as any));
  vi.mocked(PluginLoader).mockImplementation(() => ({
    loadAll: vi.fn().mockResolvedValue(pluginRegistry),
  } as any));
  vi.mocked(UsageTracker).mockImplementation(() => ({} as any));
  vi.mocked(InstanceCoordinator).mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  } as any));
  vi.mocked(HealthServer).mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as any));
  vi.mocked(initSecurity).mockReturnValue({
    pairingStore: {} as any,
    allowlistStore: {} as any,
    rateLimiter: {} as any,
    securityGate: {} as any,
  });
  vi.mocked(initIntelligence).mockReturnValue({
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
  } as any);
  vi.mocked(startChannelAdapters).mockResolvedValue(undefined as any);

  return { logger, bridge, pluginRegistry };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("lifecycle.ts — OpenRouter model registration (model-sync block)", () => {
  let originalApiKey: string | undefined;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalApiKey = process.env["OPENROUTER_API_KEY"];
    // Suppress the startup banner console.log calls
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env["OPENROUTER_API_KEY"] = originalApiKey;
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("registers unknown openrouter model via API fetch (happy path)", async () => {
    await wireAllMocks();

    const ocConfig = makeOcConfig();
    const ocJson = JSON.stringify(ocConfig);

    // First readFileSync → model sync; second → startup summary
    vi.mocked(readFileSync)
      .mockReturnValueOnce(ocJson)
      .mockReturnValue(ocJson);

    // No agent files to sync
    vi.mocked(readdirSync).mockReturnValue([] as any);

    process.env["OPENROUTER_API_KEY"] = "test-key-123";

    // Mock OpenRouter API response
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        context_length: 200000,
        top_provider: { max_completion_tokens: 32768 },
        supported_parameters: ["tools", "temperature"],
        name: "Test Model Fancy Name",
      }),
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        context_length: 65536,
        top_provider: { max_completion_tokens: 8192 },
        supported_parameters: ["tools"],
        name: "Small Model Name",
      }),
    } as Response);
    globalThis.fetch = fetchMock;

    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    // writeFileSync should have been called to persist the registered model
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
      OC_PATH,
      expect.stringContaining("test-provider/some-model"),
    );

    // Verify model entry structure
    const writeCall = vi.mocked(writeFileSync).mock.calls.find(([p]) => p === OC_PATH);
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.provider.openrouter.models["test-provider/some-model"]).toMatchObject({
      name: "Test Model Fancy Name",
      tool_call: true,
      limit: { context: 200000, output: 32768 },
    });
  });

  it("falls back to safe defaults when OpenRouter API is unreachable", async () => {
    await wireAllMocks();

    const ocConfig = makeOcConfig();
    const ocJson = JSON.stringify(ocConfig);
    vi.mocked(readFileSync).mockReturnValueOnce(ocJson).mockReturnValue(ocJson);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    process.env["OPENROUTER_API_KEY"] = "test-key-123";

    // Simulate network failure
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    // Model should still be registered — with safe defaults
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
      OC_PATH,
      expect.stringContaining("test-provider/some-model"),
    );

    const writeCall = vi.mocked(writeFileSync).mock.calls.find(([p]) => p === OC_PATH);
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    const entry = written.provider.openrouter.models["test-provider/some-model"];
    expect(entry).toBeDefined();
    // Safe defaults
    expect(entry.limit.context).toBe(131072);
    expect(entry.limit.output).toBe(16384);
    expect(entry.tool_call).toBe(true);
  });

  it("skips registration when model already exists in provider map", async () => {
    await wireAllMocks();

    // opencode.json already has this model registered
    const ocConfig = makeOcConfig({
      model: "openrouter/test-provider/some-model",
      provider: {
        openrouter: {
          options: { baseURL: "https://openrouter.ai/api/v1" },
          models: {
            "test-provider/some-model": {
              name: "Already Registered",
              tool_call: true,
              limit: { context: 128000, output: 8192 },
            },
          },
        },
      },
    });
    const ocJson = JSON.stringify(ocConfig);
    vi.mocked(readFileSync).mockReturnValueOnce(ocJson).mockReturnValue(ocJson);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    process.env["OPENROUTER_API_KEY"] = "test-key-123";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const { loadConfig } = await import("../../src/config/loader.js");
    vi.mocked(loadConfig).mockReturnValue(makeConfig({
      // primary model already in provider map — small is new
      models: { primary: "openrouter/test-provider/some-model" },
    }) as any);

    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    // fetch should NOT have been called for the already-registered model
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("test-provider/some-model"),
      expect.anything(),
    );
  });

  it("skips registration for non-openrouter models (no openrouter/ prefix)", async () => {
    await wireAllMocks();

    const { loadConfig } = await import("../../src/config/loader.js");
    // Anthropic model — no openrouter/ prefix
    vi.mocked(loadConfig).mockReturnValue(makeConfig({
      models: { primary: "anthropic/claude-3-5-sonnet", small: "anthropic/claude-haiku" },
    }) as any);

    const ocConfig = makeOcConfig({ model: "anthropic/claude-3-5-sonnet" });
    const ocJson = JSON.stringify(ocConfig);
    vi.mocked(readFileSync).mockReturnValueOnce(ocJson).mockReturnValue(ocJson);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    // fetch should NOT be called for non-openrouter models
    expect(fetchMock).not.toHaveBeenCalled();

    // writeFileSync may have been called for model update (model !== primary), but
    // provider.openrouter.models should NOT contain any anthropic models
    const writeCalls = vi.mocked(writeFileSync).mock.calls.filter(([p]) => p === OC_PATH);
    for (const [, content] of writeCalls) {
      const parsed = JSON.parse(content as string);
      const orModels = parsed.provider?.openrouter?.models ?? {};
      expect(Object.keys(orModels)).toHaveLength(0);
    }
  });

  it("skips OpenRouter API fetch when OPENROUTER_API_KEY is not set", async () => {
    await wireAllMocks();

    delete process.env["OPENROUTER_API_KEY"];

    const ocConfig = makeOcConfig();
    const ocJson = JSON.stringify(ocConfig);
    vi.mocked(readFileSync).mockReturnValueOnce(ocJson).mockReturnValue(ocJson);
    vi.mocked(readdirSync).mockReturnValue([] as any);

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    // fetch should NOT be called when no API key
    expect(fetchMock).not.toHaveBeenCalled();

    // Model should still be registered with safe defaults (the API-key guard is inside the fetch block)
    const writeCalls = vi.mocked(writeFileSync).mock.calls.filter(([p]) => p === OC_PATH);
    expect(writeCalls.length).toBeGreaterThan(0);

    const firstCall = writeCalls[0];
    expect(firstCall).toBeDefined();
    const written = JSON.parse(firstCall![1] as string);
    const entry = written.provider.openrouter.models["test-provider/some-model"];
    expect(entry).toBeDefined();
    // Safe defaults applied (no API fetch)
    expect(entry.limit.context).toBe(131072);
  });

  it("syncs primary model to agent .md frontmatter", async () => {
    await wireAllMocks();

    const ocConfig = makeOcConfig();
    const ocJson = JSON.stringify(ocConfig);
    vi.mocked(readFileSync)
      .mockReturnValueOnce(ocJson) // model sync
      .mockReturnValueOnce("---\nmodel: old-model\ntitle: Test Agent\n---\nAgent content.") // agent file read
      .mockReturnValue(ocJson); // startup summary

    vi.mocked(readdirSync).mockReturnValue(["test-agent.md"] as any);

    process.env["OPENROUTER_API_KEY"] = "test-key";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
    } as Response);

    const { startGateway } = await import("../../src/gateway/lifecycle.js");
    await startGateway();

    // writeFileSync should have been called for the agent .md file with updated model
    const agentWriteCall = vi.mocked(writeFileSync).mock.calls.find(
      ([p]) => typeof p === "string" && p.includes("test-agent.md"),
    );
    expect(agentWriteCall).toBeDefined();
    expect(agentWriteCall![1]).toContain("model: openrouter/test-provider/some-model");
  });

  it("handles missing .opencode/agent/ directory gracefully", async () => {
    await wireAllMocks();

    const ocConfig = makeOcConfig();
    const ocJson = JSON.stringify(ocConfig);
    vi.mocked(readFileSync).mockReturnValueOnce(ocJson).mockReturnValue(ocJson);

    // readdirSync throws ENOENT — directory doesn't exist
    vi.mocked(readdirSync).mockImplementation(() => {
      const err = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
      throw err;
    });

    process.env["OPENROUTER_API_KEY"] = "test-key";
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response);

    const { startGateway } = await import("../../src/gateway/lifecycle.js");

    // Should not throw — the try/catch around agent sync handles it
    await expect(startGateway()).resolves.toBeDefined();

    // No agent file should have been written
    const agentWriteCall = vi.mocked(writeFileSync).mock.calls.find(
      ([p]) => typeof p === "string" && p.includes(AGENT_DIR),
    );
    expect(agentWriteCall).toBeUndefined();
  });
});
