/**
 * Integration test: startChannelAdapters with signalStore=null (Closes #55)
 *
 * The optional chain `signalStore?.getLatestSignal(...)` must not throw when
 * signalStore is null and arcDetector must receive `undefined` as language.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { startChannelAdapters } from "../../src/gateway/adapters.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { PluginRegistry } from "../../src/plugins/registry.js";
import { makeInboundMessage } from "../helpers/fixtures.js";
import { TypedEventEmitter } from "../../src/utils/typed-emitter.js";
import type { ChannelAdapter, ChannelEvents, ChannelCapabilities } from "../../src/channels/adapter.js";
import type { ChannelAccountConfig, IrisConfig } from "../../src/config/types.js";

function makeLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(), fatal: vi.fn(),
  } as any;
}

class ControllableAdapter implements ChannelAdapter {
  readonly id = "mock";
  readonly label = "Mock";
  readonly capabilities: ChannelCapabilities = {
    text: true, image: false, video: false, audio: false, document: false,
    reaction: false, typing: true, edit: false, delete: false, reply: true,
    thread: false, maxTextLength: 4096,
  };
  readonly events = new TypedEventEmitter<ChannelEvents>();
  isConnected = false;
  async start(_cfg: ChannelAccountConfig, _signal: AbortSignal): Promise<void> {
    this.isConnected = true;
    this.events.emit("connected");
  }
  async stop(): Promise<void> { this.isConnected = false; }
  async sendText(_p: any): Promise<string> { return "ok"; }
  async sendMedia(_p: any): Promise<string> { return "ok"; }
  async sendTyping(_chatId: string): Promise<void> {}
}

function makeConfig(): IrisConfig {
  return {
    channels: { mock: { type: "telegram", enabled: true, token: "x" } },
    opencode: { baseUrl: "http://localhost:3000", timeoutMs: 5000 },
    security: {
      defaultDmPolicy: "open", pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8, rateLimitPerMinute: 30, rateLimitPerHour: 300,
    },
  } as unknown as IrisConfig;
}

describe("startChannelAdapters — signalStore=null", () => {
  let adapter: ControllableAdapter;
  let registry: ChannelRegistry;
  let pluginRegistry: PluginRegistry;
  let vaultStore: any;
  let router: any;
  let arcDetector: any;
  let abortController: AbortController;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    adapter = new ControllableAdapter();
    registry = new ChannelRegistry();
    pluginRegistry = new PluginRegistry();
    pluginRegistry.channels.set("telegram", () => adapter);
    vaultStore = { upsertProfile: vi.fn(), getProfile: vi.fn() };
    router = { handleInbound: vi.fn().mockResolvedValue(undefined) };
    arcDetector = { processMemory: vi.fn() };
    abortController = new AbortController();
    logger = makeLogger();
  });

  it("processes inbound message without throwing when signalStore is null", async () => {
    await startChannelAdapters({
      config: makeConfig(), logger, registry,
      messageCache: null as any, canvasServer: null, vaultStore, router,
      activityTracker: null, inferenceEngine: null, outcomeAnalyzer: null,
      arcDetector, profileEnricher: null, signalStore: null,
      pluginRegistry, abortController,
    });

    const msg = makeInboundMessage({ channelId: "mock", senderId: "alice", text: "hi" });
    adapter.events.emit("message", msg);
    await new Promise((r) => setTimeout(r, 0));

    expect(arcDetector.processMemory).toHaveBeenCalledOnce();
    const [, , , , lang] = arcDetector.processMemory.mock.calls[0]!;
    expect(lang).toBeUndefined();
    expect(router.handleInbound).toHaveBeenCalledWith(msg);
  });

  it("skips arcDetector when message has no text (signalStore=null)", async () => {
    await startChannelAdapters({
      config: makeConfig(), logger, registry,
      messageCache: null as any, canvasServer: null, vaultStore, router,
      activityTracker: null, inferenceEngine: null, outcomeAnalyzer: null,
      arcDetector, profileEnricher: null, signalStore: null,
      pluginRegistry, abortController,
    });

    const msg = makeInboundMessage({ channelId: "mock", senderId: "alice", text: undefined });
    adapter.events.emit("message", msg);
    await new Promise((r) => setTimeout(r, 0));

    expect(arcDetector.processMemory).not.toHaveBeenCalled();
    expect(router.handleInbound).toHaveBeenCalledWith(msg);
  });
});
