import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MessageRouter } from "../bridge/message-router.js";
import { OpenCodeBridge } from "../bridge/opencode-client.js";
import { SessionMap } from "../bridge/session-map.js";
import { ToolServer } from "../bridge/tool-server.js";
import { ChannelRegistry } from "../channels/registry.js";
import { MessageCache } from "../channels/message-cache.js";
import { syncModelsToOpenCode } from "../config/model-sync.js";
import { getStateDir, ensureDir } from "../config/paths.js";
import { loadConfig } from "../config/loader.js";
import type { IrisConfig } from "../config/types.js";
import { CanvasServer } from "../canvas/server.js";
import { InstanceCoordinator } from "../instance/coordinator.js";
import type { IntelligenceBus } from "../intelligence/bus.js";
import type { ArcDetector } from "../intelligence/arcs/detector.js";
import type { ArcLifecycle } from "../intelligence/arcs/lifecycle.js";
import type { CrossChannelResolver } from "../intelligence/cross-channel/resolver.js";
import type { GoalLifecycle } from "../intelligence/goals/lifecycle.js";
import type { HealthGate } from "../intelligence/health/gate.js";
import type { TrendDetector } from "../intelligence/health/trend-detector.js";
import type { InferenceEngine } from "../intelligence/inference/engine.js";
import type { OutcomeAnalyzer } from "../intelligence/outcomes/analyzer.js";
import type { PromptAssembler } from "../intelligence/prompt-assembler.js";
import type { IntelligenceStore } from "../intelligence/store.js";
import type { TriggerEvaluator } from "../intelligence/triggers/evaluator.js";
import { createLogger, type Logger } from "../logging/logger.js";
import type { ProfileEnricher } from "../onboarding/enricher.js";
import type { SignalStore } from "../onboarding/signals.js";
import type { PluginRegistry as IrisPluginRegistry } from "../plugins/registry.js";
import { PluginLoader } from "../plugins/loader.js";
import type { PulseEngine } from "../proactive/engine.js";
import type { IntentStore } from "../proactive/store.js";
import type { ActivityTracker } from "../heartbeat/activity.js";
import type { HeartbeatEngine } from "../heartbeat/engine.js";
import type { GovernanceEngine } from "../governance/engine.js";
import type { UsageTracker } from "../usage/tracker.js";
import { VaultDB } from "../vault/db.js";
import type { VaultSearch } from "../vault/search.js";
import type { VaultStore } from "../vault/store.js";
import { startChannelAdapters } from "./adapters.js";
import { bootstrapHeartbeat, startHeartbeatEngine } from "./heartbeat-bootstrap.js";
import { HealthServer } from "./health.js";
import { bootstrapIntelligence } from "./intelligence-bootstrap.js";
import { bootstrapProactive, startPulseEngine } from "./proactive-bootstrap.js";
import { waitForOpenCodeReady } from "./readiness.js";
import { initSecurity } from "./security-wiring.js";
import { registerShutdownHandlers } from "./shutdown.js";
import { wireSSEReconnect } from "./sse-wiring.js";
import { printStartupSummary } from "./startup-summary.js";
import {
  buildCliTools,
  buildCoreSubsystems,
  buildTemplateEngine,
} from "./subsystem-bootstrap.js";

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
  coordinator: InstanceCoordinator;
  signalStore: SignalStore | null;
  profileEnricher: ProfileEnricher | null;
  heartbeatEngine: HeartbeatEngine | null;
  activityTracker: ActivityTracker | null;
  intelligenceBus: IntelligenceBus | null;
  intelligenceStore: IntelligenceStore | null;
  inferenceEngine: InferenceEngine | null;
  triggerEvaluator: TriggerEvaluator | null;
  outcomeAnalyzer: OutcomeAnalyzer | null;
  arcDetector: ArcDetector | null;
  arcLifecycle: ArcLifecycle | null;
  goalLifecycle: GoalLifecycle | null;
  crossChannelResolver: CrossChannelResolver | null;
  trendDetector: TrendDetector | null;
  healthGate: HealthGate | null;
  promptAssembler: PromptAssembler | null;
}

export async function startGateway(configPath?: string): Promise<GatewayContext> {
  // 1. Config + logger + state dir
  const config = loadConfig(configPath);
  const logger = createLogger(config.logging);
  logger.info("Starting Iris gateway...");
  const stateDir = ensureDir(getStateDir());

  // 2. Model sync + bridge start + readiness
  await syncModelsToOpenCode(config, config.opencode, logger);
  validateOpenCodeModelKeys(config, logger);
  const bridge = new OpenCodeBridge(config.opencode, logger);
  await bridge.start();
  await waitForOpenCodeReady(bridge, logger);

  // 3. Security
  const { securityGate } = initSecurity(config, stateDir);

  // 4. Core subsystems (vault, governance, policy, onboarding)
  const vaultDb = new VaultDB(stateDir);
  const {
    vaultStore,
    vaultSearch,
    usageTracker,
    governanceEngine,
    policyEngine,
    signalStore,
    profileEnricher,
  } = buildCoreSubsystems(config, vaultDb, logger);

  // 5. Bootstrap domain engines
  const { intentStore } = bootstrapProactive(config, logger, vaultDb);
  const { heartbeatStore, activityTracker } = bootstrapHeartbeat(config, logger, vaultDb, vaultStore);
  const intel = bootstrapIntelligence(bridge, vaultDb, signalStore, intentStore, heartbeatStore, logger);
  const {
    intelligenceBus,
    intelligenceStore,
    inferenceEngine,
    triggerEvaluator,
    outcomeAnalyzer,
    arcDetector,
    arcLifecycle,
    goalLifecycle,
    crossChannelResolver,
    trendDetector,
    healthGate,
    promptAssembler,
  } = intel;

  // 6. CLI tools + plugins
  const { cliExecutor, cliRegistry } = await buildCliTools(config, stateDir, logger);
  const pluginRegistry = await new PluginLoader(logger).loadAll(config, stateDir);

  // 7. Session map + channels + auto-reply + message router
  const sessionMap = new SessionMap(stateDir);
  const registry = new ChannelRegistry();
  const messageCache = new MessageCache();
  const templateEngine = buildTemplateEngine(config, logger);
  const router = new MessageRouter(
    bridge,
    sessionMap,
    securityGate,
    registry,
    logger,
    config.channels,
    templateEngine,
    policyEngine,
    profileEnricher,
    vaultStore,
  );

  // 8. Canvas server
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

  // 9. Tool server + health server
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
    signalStore,
    cliExecutor,
    cliRegistry,
    intelligenceStore,
    goalLifecycle,
    arcLifecycle,
    arcDetector,
    outcomeAnalyzer,
    promptAssembler,
  });
  await toolServer.start();

  const coordinator = new InstanceCoordinator(vaultDb.raw());
  coordinator.start();
  const healthServer = new HealthServer(
    registry,
    bridge,
    config.gateway.port,
    config.gateway.hostname,
    coordinator,
  );
  await healthServer.start();
  logger.info({ port: config.gateway.port }, "Health server started");

  // 10. Start runtime services
  const abortController = new AbortController();
  await startChannelAdapters({
    config,
    logger,
    registry,
    messageCache,
    canvasServer,
    vaultStore,
    router,
    activityTracker,
    inferenceEngine,
    outcomeAnalyzer,
    arcDetector,
    profileEnricher,
    signalStore,
    pluginRegistry,
    abortController,
  });

  for (const [name, service] of pluginRegistry.services) {
    try {
      await service.start({ config, logger, stateDir, signal: abortController.signal });
      logger.info({ service: name }, "Plugin service started");
    } catch (err) {
      logger.error({ err, service: name }, "Failed to start plugin service");
    }
  }

  const pulseEngine = startPulseEngine(
    config,
    logger,
    intentStore,
    bridge,
    router,
    sessionMap,
    vaultStore,
    registry,
    coordinator,
  );
  const heartbeatEngine = startHeartbeatEngine(
    config,
    logger,
    heartbeatStore,
    toolServer,
    bridge,
    registry,
    vaultDb,
    sessionMap,
  );

  if (config.onboarding?.enabled && profileEnricher && signalStore) {
    const consolidateTimer = setInterval(() => {
      logger.debug("Running signal consolidation");
    }, config.onboarding.enricher.consolidateIntervalMs);
    consolidateTimer.unref();
  }

  await pluginRegistry.hookBus.emit("gateway.ready", undefined as never);

  // 11. SSE subscription with reconnect
  wireSSEReconnect(bridge, router, logger, abortController.signal);

  // 12. Shutdown handlers + summary
  registerShutdownHandlers({
    logger,
    registry,
    router,
    messageCache,
    canvasServer,
    toolServer,
    healthServer,
    bridge,
    vaultDb,
    pulseEngine,
    heartbeatEngine,
    intelligenceBus,
    pluginRegistry,
    abortController,
    coordinator,
  });
  printStartupSummary(config, governanceEngine);

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
    coordinator,
    signalStore,
    profileEnricher,
    heartbeatEngine,
    activityTracker,
    intelligenceBus,
    intelligenceStore,
    inferenceEngine,
    triggerEvaluator,
    outcomeAnalyzer,
    arcDetector,
    arcLifecycle,
    goalLifecycle,
    crossChannelResolver,
    trendDetector,
    healthGate,
    promptAssembler,
  };
}

/** Warn about legacy "openrouter/" prefix keys in opencode.json */
function validateOpenCodeModelKeys(config: IrisConfig, logger: Logger): void {
  const ocPath = join(config.opencode.projectDir ?? process.cwd(), ".opencode", "opencode.json");
  try {
    const ocConfig = JSON.parse(readFileSync(ocPath, "utf-8"));
    const providerModels = (ocConfig.provider?.openrouter?.models ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(providerModels)) {
      if (key.startsWith("openrouter/")) {
        const newKey = key.slice("openrouter/".length);
        logger.warn(
          { key, newKey },
          `Legacy model key detected in opencode.json: "${key}" uses full provider prefix — ` +
          `OpenCode will look for "${newKey}" which may not exist. ` +
          `Rename key to "${newKey}" to match auto-registration convention.`,
        );
      }
    }
  } catch {
    // opencode.json may not exist yet — skip
  }
}
