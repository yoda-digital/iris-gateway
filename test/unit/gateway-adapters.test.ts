import { describe, it, expect, vi, beforeEach } from "vitest";
import pino from "pino";

// Mock all channel adapter imports
vi.mock("../../src/channels/telegram/index.js", () => ({
  TelegramAdapter: vi.fn().mockImplementation(() => createMockAdapterInstance("telegram")),
}));
vi.mock("../../src/channels/whatsapp/index.js", () => ({
  WhatsAppAdapter: vi.fn().mockImplementation(() => createMockAdapterInstance("whatsapp")),
}));
vi.mock("../../src/channels/discord/index.js", () => ({
  DiscordAdapter: vi.fn().mockImplementation(() => createMockAdapterInstance("discord")),
}));
vi.mock("../../src/channels/slack/index.js", () => ({
  SlackAdapter: vi.fn().mockImplementation(() => createMockAdapterInstance("slack")),
}));
vi.mock("../../src/channels/webchat/index.js", () => ({
  WebChatAdapter: vi.fn().mockImplementation(() => createMockAdapterInstance("webchat")),
}));
vi.mock("../../src/gateway/metrics.js", () => ({
  metrics: {
    activeConnections: { inc: vi.fn(), dec: vi.fn() },
  },
}));

import { TypedEventEmitter } from "../../src/utils/typed-emitter.js";
import type { ChannelEvents } from "../../src/channels/adapter.js";

function createMockAdapterInstance(id: string) {
  const events = new TypedEventEmitter<ChannelEvents>();
  return {
    id,
    label: id,
    events,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    capabilities: {},
  };
}

import { startChannelAdapters } from "../../src/gateway/adapters.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { PluginRegistry } from "../../src/plugins/registry.js";

function makeBaseDeps(channelsConfig: Record<string, { type: string; enabled: boolean }>) {
  const registry = new ChannelRegistry();
  const pluginRegistry = new PluginRegistry();
  const logger = pino({ level: "silent" });
  const abortController = new AbortController();

  const vaultStore = {
    upsertProfile: vi.fn(),
  };
  const router = {
    handleInbound: vi.fn().mockResolvedValue(undefined),
  };

  const bridge = {
    approvePermission: vi.fn().mockResolvedValue(undefined),
  };

  const sessionMap = {
    findBySessionId: vi.fn().mockResolvedValue(null),
  };

  return {
    config: { channels: channelsConfig } as any,
    logger,
    registry,
    messageCache: {} as any,
    canvasServer: null,
    vaultStore: vaultStore as any,
    router: router as any,
    bridge: bridge as any,
    sessionMap: sessionMap as any,
    activityTracker: null,
    inferenceEngine: null,
    outcomeAnalyzer: null,
    arcDetector: null,
    profileEnricher: null,
    signalStore: null,
    pluginRegistry,
    abortController,
  };
}

describe("startChannelAdapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers and starts enabled channel adapters", async () => {
    const deps = makeBaseDeps({
      tg1: { type: "telegram", enabled: true },
    });
    await startChannelAdapters(deps);
    expect(deps.registry.list()).toHaveLength(1);
    expect(deps.registry.list()[0].id).toBe("telegram");
  });

  it("skips disabled channels (line 103 — disabled branch)", async () => {
    const deps = makeBaseDeps({
      tg1: { type: "telegram", enabled: false },
    });
    await startChannelAdapters(deps);
    expect(deps.registry.list()).toHaveLength(0);
  });

  it("warns and skips unknown channel type (line 116 — unknown type branch)", async () => {
    const warnSpy = vi.fn();
    const deps = makeBaseDeps({
      custom1: { type: "unknown-channel-xyz", enabled: true },
    });
    deps.logger = { ...deps.logger, warn: warnSpy, info: vi.fn(), error: vi.fn() } as any;

    await startChannelAdapters(deps);
    expect(deps.registry.list()).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "unknown-channel-xyz" }),
      "Unknown channel type",
    );
  });

  it("uses plugin factory when registered (line 116 — plugin branch)", async () => {
    const deps = makeBaseDeps({
      custom1: { type: "custom-plugin", enabled: true },
    });
    const pluginAdapter = createMockAdapterInstance("custom-plugin");
    const pluginFactory = vi.fn().mockReturnValue(pluginAdapter);
    deps.pluginRegistry.channels.set("custom-plugin", pluginFactory);

    await startChannelAdapters(deps);
    expect(pluginFactory).toHaveBeenCalled();
    expect(deps.registry.list()).toHaveLength(1);
  });

  it("catches adapter start errors and continues (lines 129-130 — error path)", async () => {
    const { TelegramAdapter } = await import("../../src/channels/telegram/index.js");
    const failingAdapter = createMockAdapterInstance("telegram");
    failingAdapter.start = vi.fn().mockRejectedValue(new Error("connection refused"));
    (TelegramAdapter as any).mockImplementationOnce(() => failingAdapter);

    const deps = makeBaseDeps({
      tg1: { type: "telegram", enabled: true },
      wa1: { type: "whatsapp", enabled: true },
    });
    await startChannelAdapters(deps);
    // failed telegram is not registered; whatsapp should succeed
    const registered = deps.registry.list();
    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe("whatsapp");
  });

  it("wires message events to router.handleInbound", async () => {
    const deps = makeBaseDeps({
      tg1: { type: "telegram", enabled: true },
    });
    await startChannelAdapters(deps);

    const adapter = deps.registry.list()[0];
    const msg = {
      senderId: "u1",
      channelId: "tg1",
      senderName: "Alice",
      text: "hello",
      timestamp: Date.now(),
    };
    adapter.events.emit("message", msg as any);

    expect(deps.vaultStore.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: "u1", channelId: "tg1" }),
    );
    expect(deps.router.handleInbound).toHaveBeenCalledWith(msg);
  });

  it("calls optional subsystems when provided on message event", async () => {
    const activityTracker = { recordMessage: vi.fn() };
    const inferenceEngine = { evaluate: vi.fn().mockResolvedValue(undefined) };
    const outcomeAnalyzer = { recordEngagement: vi.fn() };
    const arcDetector = { processMemory: vi.fn() };
    const profileEnricher = { enrich: vi.fn() };
    const signalStore = { getLatestSignal: vi.fn().mockReturnValue({ value: "ro" }) };

    const deps = makeBaseDeps({ tg1: { type: "telegram", enabled: true } });
    Object.assign(deps, { activityTracker, inferenceEngine, outcomeAnalyzer, arcDetector, profileEnricher, signalStore });

    await startChannelAdapters(deps);
    const adapter = deps.registry.list()[0];
    const msg = { senderId: "u1", channelId: "tg1", senderName: "X", text: "test", timestamp: 0 };
    adapter.events.emit("message", msg as any);

    expect(activityTracker.recordMessage).toHaveBeenCalledWith("u1", "tg1");
    expect(inferenceEngine.evaluate).toHaveBeenCalledWith("u1", "tg1");
    expect(outcomeAnalyzer.recordEngagement).toHaveBeenCalledWith("u1");
    expect(arcDetector.processMemory).toHaveBeenCalledWith("u1", "test", undefined, "conversation", "ro");
    expect(profileEnricher.enrich).toHaveBeenCalled();
  });

  it("registers multiple channels", async () => {
    const deps = makeBaseDeps({
      tg1: { type: "telegram", enabled: true },
      wa1: { type: "whatsapp", enabled: true },
      dc1: { type: "discord", enabled: true },
    });
    await startChannelAdapters(deps);
    expect(deps.registry.list()).toHaveLength(3);
  });
});
