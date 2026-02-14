import { loadConfig } from "../config/loader.js";
import { getStateDir, ensureDir } from "../config/paths.js";
import type { IrisConfig } from "../config/types.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { OpenCodeBridge } from "../bridge/opencode-client.js";
import { SessionMap } from "../bridge/session-map.js";
import { MessageRouter } from "../bridge/message-router.js";
import { ToolServer } from "../bridge/tool-server.js";
import { ChannelRegistry } from "../channels/registry.js";
import { MessageCache } from "../channels/message-cache.js";
import { SecurityGate } from "../security/dm-policy.js";
import { PairingStore } from "../security/pairing-store.js";
import { AllowlistStore } from "../security/allowlist-store.js";
import { RateLimiter } from "../security/rate-limiter.js";
import { VaultDB } from "../vault/db.js";
import { VaultStore } from "../vault/store.js";
import { VaultSearch } from "../vault/search.js";
import { GovernanceEngine } from "../governance/engine.js";
import { PolicyEngine } from "../governance/policy.js";
import { PluginLoader } from "../plugins/loader.js";
import { TemplateEngine } from "../auto-reply/engine.js";
import type { AutoReplyTemplate } from "../auto-reply/types.js";
import { UsageTracker } from "../usage/tracker.js";
import { IntentStore } from "../proactive/store.js";
import { PulseEngine } from "../proactive/engine.js";
import type { PluginRegistry as IrisPluginRegistry } from "../plugins/registry.js";
import { CanvasServer } from "../canvas/server.js";
import { WebChatAdapter } from "../channels/webchat/index.js";
import { HealthServer } from "./health.js";
import { TelegramAdapter } from "../channels/telegram/index.js";
import { WhatsAppAdapter } from "../channels/whatsapp/index.js";
import { DiscordAdapter } from "../channels/discord/index.js";
import { SlackAdapter } from "../channels/slack/index.js";
import type { ChannelAdapter } from "../channels/adapter.js";
import { SignalStore } from "../onboarding/signals.js";
import { ProfileEnricher } from "../onboarding/enricher.js";
import { HeartbeatStore } from "../heartbeat/store.js";
import { HeartbeatEngine } from "../heartbeat/engine.js";
import { ActivityTracker } from "../heartbeat/activity.js";
import { BridgeChecker, ChannelChecker, VaultChecker, SessionChecker, MemoryChecker } from "../heartbeat/checkers.js";

export interface GatewayContext {
  config: IrisConfig;
  logger: Logger;
  bridge: OpenCodeBridge;
  sessionMap: SessionMap;
  router: MessageRouter;
  toolServer: ToolServer;
  healthServer: HealthServer;
  registry: ChannelRegistry;
  messageCache: MessageCache;
  abortController: AbortController;
  vaultDb: VaultDB;
  vaultStore: VaultStore;
  vaultSearch: VaultSearch;
  governanceEngine: GovernanceEngine;
  usageTracker: UsageTracker;
  pluginRegistry: IrisPluginRegistry;
  intentStore: IntentStore | null;
  pulseEngine: PulseEngine | null;
  signalStore: SignalStore | null;
  profileEnricher: ProfileEnricher | null;
  heartbeatEngine: HeartbeatEngine | null;
  activityTracker: ActivityTracker | null;
}

const ADAPTER_FACTORIES: Record<string, () => ChannelAdapter> = {
  telegram: () => new TelegramAdapter(),
  whatsapp: () => new WhatsAppAdapter(),
  discord: () => new DiscordAdapter(),
  slack: () => new SlackAdapter(),
  webchat: () => new WebChatAdapter(),
};

const SSE_RECONNECT_DELAY_MS = 3_000;
const SSE_MAX_RECONNECT_DELAY_MS = 30_000;

export async function startGateway(
  configPath?: string,
): Promise<GatewayContext> {
  // 1. Load config
  const config = loadConfig(configPath);

  // 2. Create logger
  const logger = createLogger(config.logging);
  logger.info("Starting Iris gateway...");

  // 3. Ensure state directory
  const stateDir = ensureDir(getStateDir());

  // 4. Start OpenCode bridge
  const bridge = new OpenCodeBridge(config.opencode, logger);
  await bridge.start();

  // 4.5 Wait for OpenCode to be fully ready (providers, plugins)
  // Session CRUD alone doesn't trigger provider initialization — we must
  // send an actual prompt so providers lazy-load before real traffic arrives.
  const READY_TIMEOUT_MS = 60_000;
  const READY_POLL_MS = 500;
  const readyStart = Date.now();
  let warmupDone = false;
  while (Date.now() - readyStart < READY_TIMEOUT_MS) {
    try {
      const healthy = await bridge.checkHealth();
      if (healthy) {
        const testSession = await bridge.createSession("__readiness_check__");
        try {
          // Synchronous prompt forces providers to initialize
          await bridge.sendMessage(testSession.id, "ping");
          warmupDone = true;
        } catch {
          // Provider init may fail on first attempt; retry after delay
        }
        await bridge.deleteSession(testSession.id);
        if (warmupDone) {
          logger.info("OpenCode ready (providers warmed up)");
          break;
        }
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  if (!warmupDone) {
    logger.warn("OpenCode warmup timed out — providers may not be ready");
  }

  // 5. Create security components
  const pairingStore = new PairingStore(
    stateDir,
    config.security.pairingCodeTtlMs,
    config.security.pairingCodeLength,
  );
  const allowlistStore = new AllowlistStore(stateDir);
  const rateLimiter = new RateLimiter({
    perMinute: config.security.rateLimitPerMinute,
    perHour: config.security.rateLimitPerHour,
  });
  const securityGate = new SecurityGate(
    pairingStore,
    allowlistStore,
    rateLimiter,
    config.security,
  );

  // 5.5 Initialize vault
  const vaultDb = new VaultDB(stateDir);
  const vaultStore = new VaultStore(vaultDb);
  const vaultSearch = new VaultSearch(vaultDb);

  // 5.55 Initialize usage tracker
  const usageTracker = new UsageTracker(vaultDb);

  // 5.55b Initialize onboarding
  let signalStore: SignalStore | null = null;
  let profileEnricher: ProfileEnricher | null = null;
  if (config.onboarding?.enabled) {
    signalStore = new SignalStore(vaultDb);
    profileEnricher = new ProfileEnricher(signalStore, vaultStore, logger);
    logger.info("Onboarding enricher initialized");
  }

  // 5.6 Initialize governance
  const governanceEngine = new GovernanceEngine(
    config.governance ?? { enabled: false, rules: [], directives: [] },
  );

  // 5.65 Initialize master policy
  const policyEngine = new PolicyEngine(
    config.policy ?? { enabled: false, tools: { allowed: [], denied: [] }, permissions: { bash: "deny", edit: "deny", read: "deny" }, agents: { allowedModes: ["subagent"], maxSteps: 0, requireDescription: true, defaultTools: ["vault_search", "skill"], allowPrimaryCreation: false }, skills: { restricted: [], requireTriggers: false }, enforcement: { blockUnknownTools: true, auditPolicyViolations: true } },
  );
  if (policyEngine.enabled) {
    logger.info("Master policy engine enabled");
  }

  // 5.7 Initialize proactive system
  let intentStore: IntentStore | null = null;
  let pulseEngine: PulseEngine | null = null;
  if (config.proactive?.enabled) {
    intentStore = new IntentStore(vaultDb);
    logger.info("Proactive intent store initialized");
  }

  // 5.75 Initialize heartbeat
  let heartbeatStore: HeartbeatStore | null = null;
  let heartbeatEngine: HeartbeatEngine | null = null;
  let activityTracker: ActivityTracker | null = null;
  if (config.heartbeat?.enabled) {
    heartbeatStore = new HeartbeatStore(vaultDb);
    activityTracker = new ActivityTracker(vaultDb, vaultStore);
    logger.info("Heartbeat store initialized");
  }

  // 5.8 Load plugins
  const pluginRegistry = await new PluginLoader(logger).loadAll(config, stateDir);

  // 6. Create session map
  const sessionMap = new SessionMap(stateDir);

  // 7. Create channel registry and message cache
  const registry = new ChannelRegistry();
  const messageCache = new MessageCache();

  // 7.5 Create auto-reply template engine
  let templateEngine: TemplateEngine | null = null;
  if (config.autoReply?.enabled && config.autoReply.templates.length > 0) {
    const templates: AutoReplyTemplate[] = config.autoReply.templates.map((t) => ({
      id: t.id,
      trigger: t.trigger as AutoReplyTemplate["trigger"],
      response: t.response,
      priority: t.priority,
      cooldown: t.cooldown,
      once: t.once,
      channels: t.channels,
      chatTypes: t.chatTypes,
      forwardToAi: t.forwardToAi,
    }));
    templateEngine = new TemplateEngine(templates);
    logger.info({ count: templates.length }, "Auto-reply templates loaded");
  }

  // 8. Create message router
  const router = new MessageRouter(
    bridge,
    sessionMap,
    securityGate,
    registry,
    logger,
    config.channels,
    templateEngine,
  );

  // 8.5 Start canvas server if enabled
  let canvasServer: CanvasServer | null = null;
  if (config.canvas?.enabled) {
    canvasServer = new CanvasServer({
      port: config.canvas.port,
      hostname: config.canvas.hostname,
      logger,
      onMessage: (sessionId, text) => {
        const webchatAdapter = registry.get("webchat");
        if (webchatAdapter) {
          webchatAdapter.events.emit("message", {
            id: `wc-${Date.now()}`,
            channelId: "webchat",
            senderId: `webchat:${sessionId}`,
            senderName: "Web User",
            chatId: sessionId,
            chatType: "dm" as const,
            text,
            timestamp: Date.now(),
            raw: null,
          });
        }
      },
    });
    await canvasServer.start();
    logger.info({ port: config.canvas.port }, "Canvas server started");
  }

  // 9. Start tool server
  const toolServer = new ToolServer({
    registry,
    logger,
    vaultStore,
    vaultSearch,
    governanceEngine,
    policyEngine,
    sessionMap,
    pluginTools: pluginRegistry.tools,
    usageTracker,
    canvasServer,
    intentStore,
  });
  await toolServer.start();

  // 10. Start health server
  const healthServer = new HealthServer(
    registry,
    bridge,
    config.gateway.port,
    config.gateway.hostname,
  );
  await healthServer.start();
  logger.info(
    { port: config.gateway.port },
    "Health server started",
  );

  // 11. Create abort controller
  const abortController = new AbortController();

  // 12. Register and start channel adapters
  for (const [id, channelConfig] of Object.entries(config.channels)) {
    if (!channelConfig.enabled) {
      logger.info({ channel: id }, "Channel disabled, skipping");
      continue;
    }

    const builtInFactory = ADAPTER_FACTORIES[channelConfig.type];
    const pluginFactory = pluginRegistry.channels.get(channelConfig.type);
    if (!builtInFactory && !pluginFactory) {
      logger.warn(
        { channel: id, type: channelConfig.type },
        "Unknown channel type",
      );
      continue;
    }

    const adapter = pluginFactory
      ? pluginFactory(channelConfig, abortController.signal)
      : builtInFactory!();

    // Inject message cache into adapters that support it
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
      vaultStore.upsertProfile({
        senderId: msg.senderId,
        channelId: msg.channelId,
        name: msg.senderName || null,
      });

      // Enrich profile from message signals
      if (profileEnricher && msg.text) {
        profileEnricher.enrich({
          senderId: msg.senderId,
          channelId: msg.channelId,
          text: msg.text,
          timestamp: msg.timestamp,
        });
      }

      // Track activity for heartbeat
      if (activityTracker) {
        activityTracker.recordMessage(msg.senderId, msg.channelId);
      }

      router.handleInbound(msg).catch((err) => {
        logger.error({ err, channel: id }, "Failed to handle message");
      });
    });

    adapter.events.on("connected", () => {
      logger.info({ channel: id }, "Channel connected");
    });

    adapter.events.on("disconnected", (reason) => {
      logger.warn({ channel: id, reason }, "Channel disconnected");
    });

    adapter.events.on("error", (err) => {
      logger.error({ err, channel: id }, "Channel error");
    });

    try {
      await adapter.start(channelConfig, abortController.signal);
      // Register AFTER successful start
      registry.register(adapter);
      logger.info({ channel: id }, "Channel started");
    } catch (err) {
      logger.error({ err, channel: id }, "Failed to start channel");
    }
  }

  // 12.5 Start plugin services
  for (const [name, service] of pluginRegistry.services) {
    try {
      await service.start({ config, logger, stateDir, signal: abortController.signal });
      logger.info({ service: name }, "Plugin service started");
    } catch (err) {
      logger.error({ err, service: name }, "Failed to start plugin service");
    }
  }

  // 12.6 Start proactive pulse engine
  if (config.proactive?.enabled && intentStore) {
    pulseEngine = new PulseEngine({
      store: intentStore,
      bridge,
      router,
      sessionMap,
      vaultStore,
      registry,
      logger,
      config: config.proactive,
    });
    pulseEngine.start();
    logger.info("Proactive pulse engine started");
  }

  // 12.7 Start heartbeat engine
  if (config.heartbeat?.enabled && heartbeatStore) {
    const checkers = [
      new BridgeChecker(bridge),
      new ChannelChecker(registry),
      new VaultChecker(vaultDb),
      new SessionChecker(sessionMap),
      new MemoryChecker(),
    ];
    heartbeatEngine = new HeartbeatEngine({
      store: heartbeatStore,
      checkers,
      logger,
      config: config.heartbeat,
    });
    heartbeatEngine.start();
    logger.info("Heartbeat engine started");
  }

  // 12.8 Start onboarding consolidation timer
  if (config.onboarding?.enabled && profileEnricher && signalStore) {
    const consolidateMs = config.onboarding.enricher.consolidateIntervalMs;
    const consolidateTimer = setInterval(() => {
      logger.debug("Running signal consolidation");
    }, consolidateMs);
    consolidateTimer.unref();
  }

  // Emit gateway.ready hook
  await pluginRegistry.hookBus.emit("gateway.ready", undefined as never);

  // 13. SSE subscription disabled — causes invalid_union error in OpenCode
  // that kills prompt processing. Using polling in sendAndWait instead.
  // startEventSubscription(bridge, router, logger, abortController.signal);

  // 14. Graceful shutdown (use 'once' to avoid handler accumulation)
  const SHUTDOWN_TIMEOUT_MS = 15_000;
  let shutdownInProgress = false;

  const shutdown = async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    logger.info("Shutting down gracefully...");

    // Set a hard timeout to force exit
    const forceExit = setTimeout(() => {
      logger.warn("Shutdown timeout reached, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    abortController.abort();

    // Stop proactive engine
    if (pulseEngine) pulseEngine.stop();

    // Stop heartbeat engine
    if (heartbeatEngine) heartbeatEngine.stop();

    // Stop accepting new messages first
    for (const adapter of registry.list()) {
      try {
        await adapter.stop();
      } catch (err) {
        logger.error({ err, channel: adapter.id }, "Error stopping channel");
      }
    }

    // Emit shutdown hook and stop plugin services
    await pluginRegistry.hookBus.emit("gateway.shutdown", undefined as never);
    for (const [name, service] of pluginRegistry.services) {
      try { await service.stop(); } catch (err) {
        logger.error({ err, service: name }, "Error stopping plugin service");
      }
    }

    // Dispose router (drains any pending responses)
    router.dispose();
    messageCache.dispose();

    // Stop servers
    if (canvasServer) await canvasServer.stop();
    await toolServer.stop();
    await healthServer.stop();
    await bridge.stop();
    vaultDb.close();

    clearTimeout(forceExit);
    logger.info("Shutdown complete");
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  logger.info("Iris gateway started");
  return {
    config,
    logger,
    bridge,
    sessionMap,
    router,
    toolServer,
    healthServer,
    registry,
    messageCache,
    abortController,
    vaultDb,
    vaultStore,
    vaultSearch,
    governanceEngine,
    usageTracker,
    pluginRegistry,
    intentStore,
    pulseEngine,
    signalStore,
    profileEnricher,
    heartbeatEngine,
    activityTracker,
  };
}

function startEventSubscription(
  bridge: OpenCodeBridge,
  router: MessageRouter,
  logger: Logger,
  signal: AbortSignal,
): void {
  let delay = SSE_RECONNECT_DELAY_MS;

  const connect = () => {
    if (signal.aborted) return;

    bridge
      .subscribeEvents((event) => {
        router.getEventHandler().handleEvent(event);
      })
      .then(() => {
        // Stream ended normally — reconnect if not shutting down
        if (!signal.aborted) {
          logger.warn("SSE stream ended, reconnecting...");
          delay = SSE_RECONNECT_DELAY_MS; // Reset delay on clean end
          setTimeout(connect, delay);
        }
      })
      .catch((err) => {
        if (signal.aborted) return;
        logger.error({ err }, "SSE subscription error, reconnecting...");
        setTimeout(connect, delay);
        delay = Math.min(delay * 2, SSE_MAX_RECONNECT_DELAY_MS);
      });
  };

  connect();
}
