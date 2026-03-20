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
import { IntentStore } from "../proactive/store.js";
import { PulseEngine } from "../proactive/engine.js";
import type { PluginRegistry as IrisPluginRegistry } from "../plugins/registry.js";
import { CanvasServer } from "../canvas/server.js";
import { HealthServer } from "./health.js";
import { SignalStore } from "../onboarding/signals.js";
import { ProfileEnricher } from "../onboarding/enricher.js";
import { HeartbeatStore } from "../heartbeat/store.js";
import { HeartbeatEngine } from "../heartbeat/engine.js";
import { ActivityTracker } from "../heartbeat/activity.js";
import { BridgeChecker, ChannelChecker, VaultChecker, SessionChecker, MemoryChecker } from "../heartbeat/checkers.js";
import { CliExecutor } from "../cli/executor.js";
import { InstanceCoordinator } from "../instance/coordinator.js";
import { CliToolRegistry } from "../cli/registry.js";
import { initSecurity } from "./security-wiring.js";
import { initIntelligence } from "./intelligence-wiring.js";
import { startChannelAdapters } from "./adapters.js";
import { registerShutdownHandlers } from "./shutdown.js";
import type { IntelligenceBus } from "../intelligence/bus.js";
import type { IntelligenceStore } from "../intelligence/store.js";
import type { InferenceEngine } from "../intelligence/inference/engine.js";
import type { TriggerEvaluator } from "../intelligence/triggers/evaluator.js";
import type { OutcomeAnalyzer } from "../intelligence/outcomes/analyzer.js";
import type { ArcDetector, TitleGeneratorFn } from "../intelligence/arcs/detector.js";
import type { ArcLifecycle } from "../intelligence/arcs/lifecycle.js";
import type { GoalLifecycle } from "../intelligence/goals/lifecycle.js";
import type { CrossChannelResolver } from "../intelligence/cross-channel/resolver.js";
import type { HealthGate } from "../intelligence/health/gate.js";
import type { PromptAssembler } from "../intelligence/prompt-assembler.js";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

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
  healthGate: HealthGate | null;
  promptAssembler: PromptAssembler | null;
}

const SSE_RECONNECT_DELAY_MS = 3_000;
const SSE_MAX_RECONNECT_DELAY_MS = 30_000;

export async function startGateway(configPath?: string): Promise<GatewayContext> {
  // 1. Load config
  const config = loadConfig(configPath);

  // 2. Create logger
  const logger = createLogger(config.logging);
  logger.info("Starting Iris gateway...");

  // 3. Ensure state directory
  const stateDir = ensureDir(getStateDir());

  // 4. Sync iris.config.json models → opencode.json (before bridge starts)
  if (config.models && typeof config.models === "object") {
    const ocPath = join(config.opencode.projectDir ?? process.cwd(), ".opencode", "opencode.json");
    try {
      const ocConfig = JSON.parse(readFileSync(ocPath, "utf-8"));
      let changed = false;
      const models = config.models as Record<string, string>;

      if (models.primary && ocConfig.model !== models.primary) {
        ocConfig.model = models.primary;
        changed = true;
      }
      if (models.small && ocConfig.small_model !== models.small) {
        ocConfig.small_model = models.small;
        changed = true;
      }
      // Register unknown models in provider.openrouter.models.
      // OpenCode silently fails on unknown models — no tool calls, empty responses.
      // We query the OpenRouter /models API to get real capabilities (context window, etc.)
      // and register each model correctly. Falls back to safe defaults if API unreachable.
      const newModels = [models.primary, models.small].filter(Boolean) as string[];
      for (const modelId of newModels) {
        const orPrefix = "openrouter/";
        if (!modelId.startsWith(orPrefix)) continue;
        const orModelId = modelId.slice(orPrefix.length);

        const providerModels = ocConfig.provider?.openrouter?.models ?? {};
        if (!providerModels[orModelId]) {
          // Query OpenRouter for real model capabilities
          let contextWindow = 131072;
          let maxOutput = 16384;
          let supportsTools = true;
          let modelName = orModelId;

          try {
            const apiKey = process.env["OPENROUTER_API_KEY"];
            if (apiKey) {
              const resp = await fetch(
                `https://openrouter.ai/api/v1/models/${encodeURIComponent(orModelId)}`,
                { headers: { Authorization: `Bearer ${apiKey}` } }
              );
              if (resp.ok) {
                const data = await resp.json() as Record<string, unknown>;
                if (typeof data.context_length === "number") contextWindow = data.context_length;
                const topProvider = data.top_provider as Record<string, unknown> | undefined;
                if (typeof topProvider?.max_completion_tokens === "number") maxOutput = topProvider.max_completion_tokens;
                if (Array.isArray(data.supported_parameters)) {
                  supportsTools = (data.supported_parameters as string[]).includes("tools");
                }
                if (typeof data.name === "string") modelName = data.name;
                logger.info({ contextWindow, maxOutput, supportsTools }, `Fetched capabilities for ${orModelId} from OpenRouter`);
              }
            }
          } catch { /* API unreachable — use safe defaults */ }

          const entry: Record<string, unknown> = {
            name: modelName,
            attachment: true,
            tool_call: supportsTools,
            limit: { context: contextWindow, output: maxOutput },
          };
          // Note: interleaved/reasoning flags are intentionally NOT set here.
          // They are model-specific (e.g. DeepSeek-R1 reasoning_content) and must be
          // configured manually — wrong flags cause silent hang waiting for a field that never arrives.

          if (!ocConfig.provider) ocConfig.provider = {};
          if (!ocConfig.provider.openrouter) ocConfig.provider.openrouter = { options: { baseURL: "https://openrouter.ai/api/v1" }, models: {} };
          if (!ocConfig.provider.openrouter.models) ocConfig.provider.openrouter.models = {};
          ocConfig.provider.openrouter.models[orModelId] = entry;
          changed = true;
          logger.info({ contextWindow, maxOutput, supportsTools }, `Registered model in opencode.json: ${orModelId}`);
        }
      }

      if (changed) {
        writeFileSync(ocPath, JSON.stringify(ocConfig, null, 2));
        logger.info({
          model: ocConfig.model,
          small_model: ocConfig.small_model,
        }, "Synced models from iris.config.json to opencode.json");
      }

      // Also sync primary model into agent frontmatter — agent model: overrides opencode.json
      if (models.primary) {
        const agentDir = join(config.opencode.projectDir ?? process.cwd(), ".opencode", "agent");
        try {
          const { readdirSync } = await import("node:fs");
          const agentFiles = readdirSync(agentDir).filter((f: string) => f.endsWith(".md"));
          for (const file of agentFiles) {
            const agentPath = join(agentDir, file);
            const content = readFileSync(agentPath, "utf-8");
            if (content.startsWith("---") && /^model:/m.test(content)) {
              const updated = content.replace(/^(model:\s*)(.+)$/m, `$1${models.primary}`);
              if (updated !== content) {
                writeFileSync(agentPath, updated);
                logger.info({ model: models.primary }, `Synced model in .opencode/agent/${file}`);
              }
            }
          }
        } catch { /* agent dir may not exist — skip */ }
      }

      const finalModel = models.primary ?? ocConfig.model ?? "unknown";
      console.log(`\n  ✔ Model: ${finalModel}\n`);
    } catch (err) {
      logger.warn({ err }, "Could not sync models to opencode.json");
    }
  }

  // 4b. Start OpenCode bridge
  const bridge = new OpenCodeBridge(config.opencode, logger);
  await bridge.start();

  // 4.5 Wait for OpenCode to be fully ready (providers, plugins)
  const READY_TIMEOUT_MS = 60_000;
  const READY_POLL_MS = 500;
  const readyStart = Date.now();
  let warmupDone = false;
  while (Date.now() - readyStart < READY_TIMEOUT_MS) {
    try {
      const healthy = await bridge.checkHealth();
      if (healthy) {
        warmupDone = true;
        logger.info("OpenCode ready (health check passed)");
        break;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  if (!warmupDone) {
    logger.warn("OpenCode warmup timed out — providers may not be ready");
  }

  // 5. Security subsystem
  const { pairingStore, allowlistStore, rateLimiter, securityGate } = initSecurity(config, stateDir);

  // 5.5 Vault
  const vaultDb = new VaultDB(stateDir);
  const vaultStore = new VaultStore(vaultDb);
  const vaultSearch = new VaultSearch(vaultDb);

  // 5.55 Usage tracker
  const usageTracker = new UsageTracker(vaultDb);

  // 5.55b Onboarding
  let signalStore: SignalStore | null = null;
  let profileEnricher: ProfileEnricher | null = null;
  if (config.onboarding?.enabled) {
    signalStore = new SignalStore(vaultDb);
    profileEnricher = new ProfileEnricher(signalStore, vaultStore, logger);
    logger.info("Onboarding enricher initialized");
  }

  // 5.6 Governance
  const governanceEngine = new GovernanceEngine(
    config.governance ?? { enabled: false, rules: [], directives: [] },
  );

  // 5.65 Master policy
  const policyEngine = new PolicyEngine(
    config.policy ?? { enabled: false, tools: { allowed: [], denied: [] }, permissions: { bash: "deny", edit: "deny", read: "deny" }, agents: { allowedModes: ["subagent"], maxSteps: 0, requireDescription: true, defaultTools: ["vault_search", "skill"], allowPrimaryCreation: false }, skills: { restricted: [], requireTriggers: false }, enforcement: { blockUnknownTools: true, auditPolicyViolations: true } },
  );
  if (policyEngine.enabled) logger.info("Master policy engine enabled");

  // 5.7 Proactive system
  let intentStore: IntentStore | null = null;
  let pulseEngine: PulseEngine | null = null;
  if (config.proactive?.enabled) {
    intentStore = new IntentStore(vaultDb);
    logger.info("Proactive intent store initialized");
  }

  // 5.75 Heartbeat
  let heartbeatStore: HeartbeatStore | null = null;
  let heartbeatEngine: HeartbeatEngine | null = null;
  let activityTracker: ActivityTracker | null = null;
  if (config.heartbeat?.enabled) {
    heartbeatStore = new HeartbeatStore(vaultDb);
    activityTracker = new ActivityTracker(vaultDb, vaultStore);
    logger.info("Heartbeat store initialized");
  }

  // 5.76 Intelligence layer
  const titleGenerator: TitleGeneratorFn = async (keywords, content) => {
    const session = await bridge.createSession("__arc_title_gen__");
    try {
      const prompt = [
        "Generate a short, human-readable title (3-6 words) for a memory arc.",
        "The title should be in the same language as the content.",
        `Keywords: ${keywords.slice(0, 6).join(", ")}`,
        `Content: ${content.substring(0, 300)}`,
        "Reply with ONLY the title — no quotes, no punctuation, no explanation.",
      ].join("\n");
      const title = await bridge.sendMessage(session.id, prompt);
      return title.trim().replace(/^["']+|["']+$/g, "");
    } finally {
      bridge.deleteSession(session.id).catch(() => {});
    }
  };
  const intel = initIntelligence(vaultDb, signalStore, intentStore, heartbeatStore, logger, titleGenerator);
  const { intelligenceBus, intelligenceStore, inferenceEngine, triggerEvaluator,
    outcomeAnalyzer, arcDetector, arcLifecycle, goalLifecycle,
    crossChannelResolver, healthGate, promptAssembler } = intel;
  const trendDetector = intel.trendDetector;

  // 5.77 CLI tools
  let cliExecutor: CliExecutor | null = null;
  let cliRegistry: CliToolRegistry | null = null;
  if (config.cli?.enabled) {
    cliRegistry = new CliToolRegistry(config.cli.tools);
    cliExecutor = new CliExecutor({ allowedBinaries: config.cli.sandbox.allowedBinaries, timeout: config.cli.timeout, logger });

    // Probe all tools in parallel (non-blocking, 2s timeout per check)
    const probeResults = await Promise.all(
      cliRegistry.listTools().map(async (toolName) => {
        const def = cliRegistry!.getToolDef(toolName)!;
        const result = await cliExecutor!.probe(def.binary, def.healthCheck);
        return { toolName, binary: def.binary, ...result };
      })
    );
    const unavailable = probeResults.filter((r) => !r.available);
    if (unavailable.length > 0) {
      for (const r of unavailable) {
        logger.warn({ tool: r.toolName, binary: r.binary, reason: r.reason }, "CLI tool unavailable — removed from manifest");
      }
      cliRegistry.removeTools(unavailable.map((r) => r.toolName));
    }

    const manifestPath = join(stateDir, "cli-tools.json");
    writeFileSync(manifestPath, JSON.stringify(cliRegistry.getManifest(), null, 2));
    logger.info({ tools: cliRegistry.listTools(), unavailable: unavailable.length }, "CLI tool registry initialized");
  }

  // 5.8 Load plugins
  const pluginRegistry = await new PluginLoader(logger).loadAll(config, stateDir);

  // 6. Session map
  const sessionMap = new SessionMap(stateDir);

  // 7. Channel registry and message cache
  const registry = new ChannelRegistry();
  const messageCache = new MessageCache();

  // 7.5 Auto-reply template engine
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

  // 8. Message router
  const router = new MessageRouter(bridge, sessionMap, securityGate, registry, logger, config.channels, templateEngine, profileEnricher, vaultStore);

  // 8.5 Canvas server
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

  // 9. Tool server
  const toolServer = new ToolServer({
    registry, logger, vaultStore, vaultSearch, governanceEngine, policyEngine,
    sessionMap, pluginTools: pluginRegistry.tools, usageTracker, canvasServer,
    intentStore, signalStore, cliExecutor, cliRegistry, intelligenceStore,
    goalLifecycle, arcLifecycle, arcDetector, outcomeAnalyzer, promptAssembler,
  });
  await toolServer.start();

  // 10. Health server
  const coordinator = new InstanceCoordinator(vaultDb.raw());
  coordinator.start();

  const healthServer = new HealthServer(registry, bridge, config.gateway.port, config.gateway.hostname, coordinator);
  await healthServer.start();
  logger.info({ port: config.gateway.port }, "Health server started");

  // 11. Abort controller
  const abortController = new AbortController();

  // 12. Channel adapters
  await startChannelAdapters({
    config, logger, registry, messageCache, canvasServer, vaultStore, router,
    activityTracker, inferenceEngine, outcomeAnalyzer, arcDetector, profileEnricher,
    signalStore,
    pluginRegistry, abortController,
  });

  // 12.5 Plugin services
  for (const [name, service] of pluginRegistry.services) {
    try {
      await service.start({ config, logger, stateDir, signal: abortController.signal });
      logger.info({ service: name }, "Plugin service started");
    } catch (err) {
      logger.error({ err, service: name }, "Failed to start plugin service");
    }
  }

  // 12.6 Proactive pulse engine
  if (config.proactive?.enabled && intentStore) {
    pulseEngine = new PulseEngine({ store: intentStore, bridge, router, sessionMap, vaultStore, registry, logger, config: config.proactive, coordinator });
    pulseEngine.start();
    logger.info("Proactive pulse engine started");
  }

  // 12.7 Heartbeat engine
  if (config.heartbeat?.enabled && heartbeatStore) {
    heartbeatEngine = new HeartbeatEngine({
      store: heartbeatStore,
      checkers: [new BridgeChecker(bridge), new ChannelChecker(registry), new VaultChecker(vaultDb), new SessionChecker(sessionMap), new MemoryChecker()],
      logger,
      config: config.heartbeat,
      getInFlightCount: () => bridge.getInFlightCount(),
    });
    heartbeatEngine.start();
    toolServer.setHeartbeatEngine(heartbeatEngine);
    logger.info("Heartbeat engine started");
  }

  // 12.8 Onboarding consolidation timer
  if (config.onboarding?.enabled && profileEnricher && signalStore) {
    const consolidateTimer = setInterval(() => { logger.debug("Running signal consolidation"); }, config.onboarding.enricher.consolidateIntervalMs);
    consolidateTimer.unref();
  }

  // Emit gateway.ready hook
  await pluginRegistry.hookBus.emit("gateway.ready", undefined as never);

  // 13. SSE subscription disabled (see original for reason)

  // 14. Graceful shutdown
  registerShutdownHandlers({
    logger, registry, router, messageCache, canvasServer, toolServer, healthServer,
    bridge, vaultDb, pulseEngine, heartbeatEngine, intelligenceBus, pluginRegistry, abortController, coordinator,
  });

  // Startup summary
  try {
    const ocPath = join(config.opencode.projectDir ?? process.cwd(), ".opencode", "opencode.json");
    const ocConfig = JSON.parse(readFileSync(ocPath, "utf-8"));
    const primaryModel = ocConfig.model ?? "unknown";
    const smallModel = ocConfig.small_model ?? "none";
    const channels = Object.keys(config.channels);
    const securityMode = config.security?.defaultDmPolicy ?? "open";
    const governanceRules = governanceEngine?.getRules?.()?.length ?? 0;

    console.log("");
    console.log("  ┌─────────────────────────────────────────┐");
    console.log("  │             Gateway Ready                │");
    console.log("  ├─────────────────────────────────────────┤");
    console.log(`  │  Model:     ${primaryModel.padEnd(28)}│`);
    console.log(`  │  Small:     ${smallModel.padEnd(28)}│`);
    console.log(`  │  Channels:  ${channels.join(", ").padEnd(28)}│`);
    console.log(`  │  Security:  ${securityMode.padEnd(28)}│`);
    console.log(`  │  Rules:     ${String(governanceRules).padEnd(28)}│`);
    console.log(`  │  OpenCode:  :${config.opencode.port}${"".padEnd(23)}│`);
    console.log(`  │  Tools:     :19877${"".padEnd(22)}│`);
    console.log(`  │  Health:    :19876${"".padEnd(22)}│`);
    console.log("  └─────────────────────────────────────────┘");
    console.log("");
  } catch { /* Best-effort */ }

  logger.info("Iris gateway started");
  return {
    config, logger, bridge, sessionMap, router, toolServer, healthServer,
    registry, messageCache, abortController, vaultDb, vaultStore, vaultSearch,
    governanceEngine, usageTracker, pluginRegistry, intentStore, pulseEngine, coordinator,
    signalStore, profileEnricher, heartbeatEngine, activityTracker,
    intelligenceBus, intelligenceStore, inferenceEngine, triggerEvaluator,
    outcomeAnalyzer, arcDetector, arcLifecycle, goalLifecycle,
    crossChannelResolver, healthGate, promptAssembler,
  };
}
