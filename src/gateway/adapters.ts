import type { IrisConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type { ChannelAdapter } from "../channels/adapter.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { MessageCache } from "../channels/message-cache.js";
import type { CanvasServer } from "../canvas/server.js";
import type { VaultStore } from "../vault/store.js";
import type { MessageRouter } from "../bridge/message-router.js";
import type { ActivityTracker } from "../heartbeat/activity.js";
import type { InferenceEngine } from "../intelligence/inference/engine.js";
import type { OutcomeAnalyzer } from "../intelligence/outcomes/analyzer.js";
import type { ArcDetector } from "../intelligence/arcs/detector.js";
import type { ProfileEnricher } from "../onboarding/enricher.js";
import type { SignalStore } from "../onboarding/signals.js";
import type { PluginRegistry as IrisPluginRegistry } from "../plugins/registry.js";
import { TelegramAdapter } from "../channels/telegram/index.js";
import { WhatsAppAdapter } from "../channels/whatsapp/index.js";
import { DiscordAdapter } from "../channels/discord/index.js";
import { SlackAdapter } from "../channels/slack/index.js";
import { WebChatAdapter } from "../channels/webchat/index.js";

// Builtin adapter factories
const ADAPTER_FACTORIES: Record<string, () => ChannelAdapter> = {
  telegram: () => new TelegramAdapter(),
  whatsapp: () => new WhatsAppAdapter(),
  discord: () => new DiscordAdapter(),
  slack: () => new SlackAdapter(),
  webchat: () => new WebChatAdapter(),
};

export interface AdapterWiringDeps {
  config: IrisConfig;
  logger: Logger;
  registry: ChannelRegistry;
  messageCache: MessageCache;
  canvasServer: CanvasServer | null;
  vaultStore: VaultStore;
  router: MessageRouter;
  activityTracker: ActivityTracker | null;
  inferenceEngine: InferenceEngine | null;
  outcomeAnalyzer: OutcomeAnalyzer | null;
  arcDetector: ArcDetector | null;
  profileEnricher: ProfileEnricher | null;
  signalStore: SignalStore | null;
  pluginRegistry: IrisPluginRegistry;
  abortController: AbortController;
}

/**
 * Register and start all enabled channel adapters.
 * Each adapter is wired to the message router and intelligence subsystems.
 */
export async function startChannelAdapters(deps: AdapterWiringDeps): Promise<void> {
  const {
    config, logger, registry, messageCache, canvasServer, vaultStore,
    router, activityTracker, inferenceEngine, outcomeAnalyzer, arcDetector,
    profileEnricher, signalStore, pluginRegistry, abortController,
  } = deps;

  for (const [id, channelConfig] of Object.entries(config.channels)) {
    if (!channelConfig.enabled) {
      logger.info({ channel: id }, "Channel disabled, skipping");
      continue;
    }

    const builtInFactory = ADAPTER_FACTORIES[channelConfig.type];
    const pluginFactory = pluginRegistry.channels.get(channelConfig.type);
    if (!builtInFactory && !pluginFactory) {
      logger.warn({ channel: id, type: channelConfig.type }, "Unknown channel type");
      continue;
    }

    const adapter = pluginFactory
      ? pluginFactory(channelConfig, abortController.signal)
      : builtInFactory!();

    // Inject message cache
    if ("setMessageCache" in adapter && typeof adapter.setMessageCache === "function") {
      (adapter as { setMessageCache(cache: MessageCache): void }).setMessageCache(messageCache);
    }

    // Wire webchat adapter to canvas server
    if ("setCanvasServer" in adapter && typeof adapter.setCanvasServer === "function" && canvasServer) {
      (adapter as { setCanvasServer(server: CanvasServer): void }).setCanvasServer(canvasServer);
    }

    // Wire adapter events to message router
    adapter.events.on("message", (msg) => {
      // Touch user profile on every inbound message
      vaultStore.upsertProfile({ senderId: msg.senderId, channelId: msg.channelId, name: msg.senderName || null });

      if (profileEnricher && msg.text) {
        profileEnricher.enrich({ senderId: msg.senderId, channelId: msg.channelId, text: msg.text, timestamp: msg.timestamp });
      }

      if (activityTracker) activityTracker.recordMessage(msg.senderId, msg.channelId);

      if (inferenceEngine) {
        inferenceEngine.evaluate(msg.senderId, msg.channelId).catch((err) => {
          logger.error({ err }, "Inference engine evaluation failed");
        });
      }

      if (outcomeAnalyzer) outcomeAnalyzer.recordEngagement(msg.senderId);

      if (arcDetector && msg.text) {
        // Resolve per-sender language from onboarding signals for correct stopword filtering.
        // Falls back gracefully to English inside ArcDetector if language is unknown.
        const detectedLanguage = signalStore
          ?.getLatestSignal(msg.senderId, msg.channelId, "language")?.value;
        arcDetector.processMemory(msg.senderId, msg.text, undefined, "conversation", detectedLanguage);
      }

      router.handleInbound(msg).catch((err) => {
        logger.error({ err, channel: id }, "Failed to handle message");
      });
    });

    adapter.events.on("connected", () => { logger.info({ channel: id }, "Channel connected"); });
    adapter.events.on("disconnected", (reason) => { logger.warn({ channel: id, reason }, "Channel disconnected"); });
    adapter.events.on("error", (err) => { logger.error({ err, channel: id }, "Channel error"); });

    try {
      await adapter.start(channelConfig, abortController.signal);
      registry.register(adapter);
      logger.info({ channel: id }, "Channel started");
    } catch (err) {
      logger.error({ err, channel: id }, "Failed to start channel");
    }
  }
}
