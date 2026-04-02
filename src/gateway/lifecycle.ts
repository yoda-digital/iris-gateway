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
import { VaultDB } from "../vault/db.js";
import { VaultStore } from "../vault/store.js";
import { VaultSearch } from "../vault/search.js";
import { GovernanceEngine } from "../governance/engine.js";
import { PolicyEngine } from "../governance/policy.js";
import { PluginLoader } from "../plugins/loader.js";
import { TemplateEngine } from "../auto-reply/engine.js";
import type { AutoReplyTemplate } from "../auto-reply/types.js";
import { UsageTracker } from "../usage/tracker.js";
import type { IntentStore } from "../proactive/store.js";
import type { PulseEngine } from "../proactive/engine.js";
import type { PluginRegistry as IrisPluginRegistry } from "../plugins/registry.js";
import { CanvasServer } from "../canvas/server.js";
import { HealthServer } from "./health.js";
import { SignalStore } from "../onboarding/signals.js";
import { ProfileEnricher } from "../onboarding/enricher.js";
import type { HeartbeatStore } from "../heartbeat/store.js";
import type { HeartbeatEngine } from "../heartbeat/engine.js";
import type { ActivityTracker } from "../heartbeat/activity.js";
import { CliExecutor } from "../cli/executor.js";
import { InstanceCoordinator } from "../instance/coordinator.js";
import { CliToolRegistry } from "../cli/registry.js";
import { initSecurity } from "./security-wiring.js";
import { startChannelAdapters } from "./adapters.js";
import { bootstrapIntelligence } from "./intelligence-bootstrap.js";
import { bootstrapHeartbeat, startHeartbeatEngine } from "./heartbeat-bootstrap.js";
import { bootstrapProactive, startPulseEngine } from "./proactive-bootstrap.js";
import { registerShutdownHandlers } from "./shutdown.js";
import type { IntelligenceBus } from "../intelligence/bus.js";
import type { IntelligenceStore } from "../intelligence/store.js";
import type { InferenceEngine } from "../intelligence/inference/engine.js";
import type { TriggerEvaluator } from "../intelligence/triggers/evaluator.js";
import type { OutcomeAnalyzer } from "../intelligence/outcomes/analyzer.js";
import type { ArcDetector } from "../intelligence/arcs/detector.js";
import type { ArcLifecycle } from "../intelligence/arcs/lifecycle.js";
import type { GoalLifecycle } from "../intelligence/goals/lifecycle.js";
import type { CrossChannelResolver } from "../intelligence/cross-channel/resolver.js";
import type { TrendDetector } from "../intelligence/health/trend-detector.js";
import type { HealthGate } from "../intelligence/health/gate.js";
import type { PromptAssembler } from "../intelligence/prompt-assembler.js";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { syncModelsToOpenCode } from "../config/model-sync.js";
import { waitForOpenCodeReady } from "./readiness.js";
import { printStartupSummary } from "./startup-summary.js";

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

interface CoreSubsystems {
  pairingStore: any; allowlistStore: any; rateLimiter: any; securityGate: any;
  vaultDb: VaultDB; vaultStore: VaultStore; vaultSearch: VaultSearch; usageTracker: UsageTracker;
  signalStore: SignalStore | null; profileEnricher: ProfileEnricher | null;
  governanceEngine: GovernanceEngine; policyEngine: PolicyEngine;
}

interface SessionLayer {
  sessionMap: SessionMap; registry: ChannelRegistry; messageCache: MessageCache; templateEngine: TemplateEngine | null;
}

const SSE_RECONNECT_DELAY_MS = 5_000;
const SSE_MAX_RECONNECT_DELAY_MS = 30_000;

function buildCoreSubsystems(config: IrisConfig, stateDir: string, logger: Logger): CoreSubsystems {
  const { pairingStore, allowlistStore, rateLimiter, securityGate } = initSecurity(config, stateDir);
  const vaultDb = new VaultDB(stateDir);
  const vaultStore = new VaultStore(vaultDb);
  const vaultSearch = new VaultSearch(vaultDb);
  const usageTracker = new UsageTracker(vaultDb);
  let signalStore: SignalStore | null = null;
  let profileEnricher: ProfileEnricher | null = null;
  if (config.onboarding?.enabled) {
    signalStore = new SignalStore(vaultDb);
    profileEnricher = new ProfileEnricher(signalStore, vaultStore, logger);
    logger.info("Onboarding enricher initialized");
  }
  const governanceEngine = new GovernanceEngine(config.governance ?? { enabled: false, rules: [], directives: [] });
  const policyEngine = new PolicyEngine(
    config.policy ?? { enabled: false, tools: { allowed: [], denied: [] }, permissions: { bash: "deny", edit: "deny", read: "deny" }, agents: { allowedModes: ["subagent"], maxSteps: 0, requireDescription: true, defaultTools: ["vault_search", "skill"], allowPrimaryCreation: false }, skills: { restricted: [], requireTriggers: false }, enforcement: { blockUnknownTools: true, auditPolicyViolations: true } },
  );
  if (policyEngine.enabled) logger.info("Master policy engine enabled");
  return { pairingStore, allowlistStore, rateLimiter, securityGate, vaultDb, vaultStore, vaultSearch, usageTracker, signalStore, profileEnricher, governanceEngine, policyEngine };
}

function buildSessionLayer(config: IrisConfig, stateDir: string, logger: Logger): SessionLayer {
  const sessionMap = new SessionMap(stateDir);
  const registry = new ChannelRegistry();
  const messageCache = new MessageCache();
  let templateEngine: TemplateEngine | null = null;
  if (config.autoReply?.enabled && config.autoReply.templates.length > 0) {
    const templates: AutoReplyTemplate[] = config.autoReply.templates.map((t) => ({
      id: t.id, trigger: t.trigger as AutoReplyTemplate["trigger"], response: t.response, priority: t.priority,
      cooldown: t.cooldown, once: t.once, channels: t.channels, chatTypes: t.chatTypes, forwardToAi: t.forwardToAi,
    }));
    templateEngine = new TemplateEngine(templates);
    logger.info({ count: templates.length }, "Auto-reply templates loaded");
  }
  return { sessionMap, registry, messageCache, templateEngine };
}

export function wireSSEReconnect(bridge: OpenCodeBridge, router: MessageRouter, abortController: AbortController, logger: Logger, initialDelayMs: number, maxDelayMs: number): void {
  let reconnectDelay = initialDelayMs;
  const wireSSE = async (): Promise<void> => {
    if (abortController.signal.aborted) return;
    try {
      await bridge.subscribeEvents((event) => { router.getEventHandler().handleEvent(event); }, abortController.signal);
      reconnectDelay = initialDelayMs;
      logger.info("OpenCode SSE subscription ended");
    } catch (err) {
      if (abortController.signal.aborted) return;
      logger.warn({ err, nextRetryMs: reconnectDelay }, `SSE subscription dropped — reconnecting in ${reconnectDelay}ms`);
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, maxDelayMs);
      setTimeout(() => { if (abortController.signal.aborted) return; void wireSSE(); }, delay);
    }
  };
  void wireSSE();
}

export async function startGateway(configPath?: string): Promise<GatewayContext> {
  const config = loadConfig(configPath);
  const logger = createLogger(config.logging);
  logger.info("Starting Iris gateway...");
  const stateDir = ensureDir(getStateDir());
  await syncModelsToOpenCode(config, config.opencode, logger);
  {
    const ocPath = join(config.opencode.projectDir ?? process.cwd(), ".opencode", "opencode.json");
    try {
      const ocConfig = JSON.parse(readFileSync(ocPath, "utf-8"));
      const providerModels = (ocConfig.provider?.openrouter?.models ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(providerModels)) {
        if (key.startsWith("openrouter/")) {
          const newKey = key.slice("openrouter/".length);
          logger.warn({ key, newKey }, `Legacy model key detected in opencode.json: "${key}" uses full provider prefix — OpenCode will look for "${newKey}" which may not exist. Rename key to "${newKey}" to match auto-registration convention.`);
        }
      }
    } catch { /* opencode.json may not exist yet — skip */ }
  }
  const bridge = new OpenCodeBridge(config.opencode, logger);
  await bridge.start();
  await waitForOpenCodeReady(bridge, logger);
  const core = buildCoreSubsystems(config, stateDir, logger);
  const { intentStore } = bootstrapProactive(config, logger, core.vaultDb);
  let pulseEngine: PulseEngine | null = null;
  const { heartbeatStore, activityTracker } = bootstrapHeartbeat(config, logger, core.vaultDb, core.vaultStore);
  let heartbeatEngine: HeartbeatEngine | null = null;
  const intel = bootstrapIntelligence(bridge, core.vaultDb, core.signalStore, intentStore, heartbeatStore, logger);
  const { intelligenceBus, intelligenceStore, inferenceEngine, triggerEvaluator, outcomeAnalyzer, arcDetector, arcLifecycle, goalLifecycle, crossChannelResolver, trendDetector, healthGate, promptAssembler } = intel;
  let cliExecutor: CliExecutor | null = null;
  let cliRegistry: CliToolRegistry | null = null;
  if (config.cli?.enabled) {
    cliRegistry = new CliToolRegistry(config.cli.tools);
    cliExecutor = new CliExecutor({ allowedBinaries: config.cli.sandbox.allowedBinaries, timeout: config.cli.timeout, logger });
    const probeResults = await Promise.all(cliRegistry.listTools().map(async (toolName) => {
      const def = cliRegistry!.getToolDef(toolName)!;
      const result = await cliExecutor!.probe(def.binary, def.healthCheck);
      return { toolName, binary: def.binary, ...result };
    }));
    const unavailable = probeResults.filter((r) => !r.available);
    if (unavailable.length > 0) {
      for (const r of unavailable) logger.warn({ tool: r.toolName, binary: r.binary, reason: r.reason }, "CLI tool unavailable — removed from manifest");
      cliRegistry.removeTools(unavailable.map((r) => r.toolName));
    }
    const manifestPath = join(stateDir, "cli-tools.json");
    writeFileSync(manifestPath, JSON.stringify(cliRegistry.getManifest(), null, 2));
    logger.info({ tools: cliRegistry.listTools(), unavailable: unavailable.length }, "CLI tool registry initialized");
  }
  const pluginRegistry = await new PluginLoader(logger).loadAll(config, stateDir);
  const session = buildSessionLayer(config, stateDir, logger);
  const router = new MessageRouter(bridge, session.sessionMap, core.securityGate, session.registry, logger, config.channels, session.templateEngine, core.profileEnricher, core.vaultStore);
  let canvasServer: CanvasServer | null = null;
  if (config.canvas?.enabled) {
    canvasServer = new CanvasServer({ port: config.canvas.port, hostname: config.canvas.hostname, logger, onMessage: (sessionId, text) => {
      const webchatAdapter = session.registry.get("webchat");
      if (webchatAdapter) webchatAdapter.events.emit("message", { id: `wc-${Date.now()}`, channelId: "webchat", senderId: `webchat:${sessionId}`, senderName: "Web User", chatId: sessionId, chatType: "dm" as const, text, timestamp: Date.now(), raw: null });
    }});
    await canvasServer.start();
    logger.info({ port: config.canvas.port }, "Canvas server started");
  }
  const toolServer = new ToolServer({ registry: session.registry, logger, vaultStore: core.vaultStore, vaultSearch: core.vaultSearch, governanceEngine: core.governanceEngine, policyEngine: core.policyEngine, sessionMap: session.sessionMap, pluginTools: pluginRegistry.tools, usageTracker: core.usageTracker, canvasServer, intentStore, signalStore: core.signalStore, cliExecutor, cliRegistry, intelligenceStore, goalLifecycle, arcLifecycle, arcDetector, outcomeAnalyzer, promptAssembler });
  await toolServer.start();
  const coordinator = new InstanceCoordinator(core.vaultDb.raw());
  coordinator.start();
  const healthServer = new HealthServer(session.registry, bridge, config.gateway.port, config.gateway.hostname, coordinator);
  await healthServer.start();
  logger.info({ port: config.gateway.port }, "Health server started");
  const abortController = new AbortController();
  await startChannelAdapters({ config, logger, registry: session.registry, messageCache: session.messageCache, canvasServer, vaultStore: core.vaultStore, router, activityTracker, inferenceEngine, outcomeAnalyzer, arcDetector, profileEnricher: core.profileEnricher, signalStore: core.signalStore, pluginRegistry, abortController });
  for (const [name, service] of pluginRegistry.services) {
    try { await service.start({ config, logger, stateDir, signal: abortController.signal }); logger.info({ service: name }, "Plugin service started"); }
    catch (err) { logger.error({ err, service: name }, "Failed to start plugin service"); }
  }
  pulseEngine = startPulseEngine(config, logger, intentStore, bridge, router, session.sessionMap, core.vaultStore, session.registry, coordinator);
  heartbeatEngine = startHeartbeatEngine(config, logger, heartbeatStore, toolServer, bridge, session.registry, core.vaultDb, session.sessionMap);
  if (config.onboarding?.enabled && core.profileEnricher && core.signalStore) {
    const consolidateTimer = setInterval(() => { logger.debug("Running signal consolidation"); }, config.onboarding.enricher.consolidateIntervalMs);
    consolidateTimer.unref();
  }
  await pluginRegistry.hookBus.emit("gateway.ready", undefined as never);
  wireSSEReconnect(bridge, router, abortController, logger, SSE_RECONNECT_DELAY_MS, SSE_MAX_RECONNECT_DELAY_MS);
  registerShutdownHandlers({ logger, registry: session.registry, router, messageCache: session.messageCache, canvasServer, toolServer, healthServer, bridge, vaultDb: core.vaultDb, pulseEngine, heartbeatEngine, intelligenceBus, pluginRegistry, abortController, coordinator });
  printStartupSummary(config, core.governanceEngine);
  logger.info("Iris gateway started");
  return { config, logger, bridge, sessionMap: session.sessionMap, router, toolServer, healthServer, registry: session.registry, messageCache: session.messageCache, abortController, vaultDb: core.vaultDb, vaultStore: core.vaultStore, vaultSearch: core.vaultSearch, governanceEngine: core.governanceEngine, usageTracker: core.usageTracker, pluginRegistry, intentStore, pulseEngine, coordinator, signalStore: core.signalStore, profileEnricher: core.profileEnricher, heartbeatEngine, activityTracker, intelligenceBus, intelligenceStore, inferenceEngine, triggerEvaluator, outcomeAnalyzer, arcDetector, arcLifecycle, goalLifecycle, crossChannelResolver, trendDetector, healthGate, promptAssembler };
}
