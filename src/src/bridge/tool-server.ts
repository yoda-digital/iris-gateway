import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ChannelRegistry } from "../channels/registry.js";
import type { Logger } from "../logging/logger.js";
import type { VaultStore } from "../vault/store.js";
import type { VaultSearch } from "../vault/search.js";
import type { GovernanceEngine } from "../governance/engine.js";
import type { SessionMap } from "./session-map.js";
import type { PluginToolDef } from "../plugins/types.js";
import type { UsageTracker } from "../usage/tracker.js";
import type { CanvasServer } from "../canvas/server.js";
import type { PolicyEngine } from "../governance/policy.js";
import type { IntentStore } from "../proactive/store.js";
import type { SignalStore } from "../onboarding/signals.js";
import type { CliExecutor } from "../cli/executor.js";
import type { CliToolRegistry } from "../cli/registry.js";
import type { IntelligenceStore } from "../intelligence/store.js";
import type { GoalLifecycle } from "../intelligence/goals/lifecycle.js";
import type { ArcLifecycle } from "../intelligence/arcs/lifecycle.js";
import type { ArcDetector } from "../intelligence/arcs/detector.js";
import type { OutcomeAnalyzer } from "../intelligence/outcomes/analyzer.js";
import type { PromptAssembler } from "../intelligence/prompt-assembler.js";
import { channelsRouter } from "./routers/channels.js";
import { vaultRouter } from "./routers/vault.js";
import { governanceRouter } from "./routers/governance.js";
import { intelligenceRouter } from "./routers/intelligence.js";
import { systemRouter } from "./routers/system.js";
import { skillsRouter } from "./routers/skills.js";
import { cliRouter } from "./routers/cli.js";

export type HeartbeatEngine = { getStatus(): Array<{ agentId: string; component: string; status: string }>; tick(): Promise<void> };

export interface ToolServerDeps {
  registry: ChannelRegistry;
  logger: Logger;
  port?: number;
  vaultStore?: VaultStore | null;
  vaultSearch?: VaultSearch | null;
  governanceEngine?: GovernanceEngine | null;
  policyEngine?: PolicyEngine | null;
  sessionMap?: SessionMap | null;
  pluginTools?: Map<string, PluginToolDef> | null;
  usageTracker?: UsageTracker | null;
  canvasServer?: CanvasServer | null;
  intentStore?: IntentStore | null;
  signalStore?: SignalStore | null;
  heartbeatEngine?: HeartbeatEngine | null;
  cliExecutor?: CliExecutor | null;
  cliRegistry?: CliToolRegistry | null;
  intelligenceStore?: IntelligenceStore | null;
  goalLifecycle?: GoalLifecycle | null;
  arcLifecycle?: ArcLifecycle | null;
  arcDetector?: ArcDetector | null;
  outcomeAnalyzer?: OutcomeAnalyzer | null;
  promptAssembler?: PromptAssembler | null;
}

export class ToolServer {
  private readonly app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private readonly logger: Logger;
  private readonly port: number;
  // Mutable ref so setHeartbeatEngine updates the systemRouter closure
  private readonly heartbeatRef: { engine: HeartbeatEngine | null };

  constructor(deps: ToolServerDeps);
  constructor(registry: ChannelRegistry, logger: Logger, port?: number);
  constructor(
    registryOrDeps: ChannelRegistry | ToolServerDeps,
    logger?: Logger,
    port?: number,
  ) {
    let deps: ToolServerDeps;
    if (logger !== undefined) {
      // Legacy 3-arg constructor
      deps = { registry: registryOrDeps as ChannelRegistry, logger, port };
    } else {
      deps = registryOrDeps as ToolServerDeps;
    }

    this.logger = deps.logger;
    this.port = deps.port ?? 19877;
    this.heartbeatRef = { engine: deps.heartbeatEngine ?? null };

    this.app = new Hono();
    this.setupMiddleware(deps.logger, deps);
    this.mountRouters(deps);
  }

  private setupMiddleware(logger: Logger, deps: ToolServerDeps): void {
    this.app.use("*", async (c, next) => {
      const start = Date.now();
      const method = c.req.method;
      const path = c.req.path;

      if (path === "/session/system-context" || path === "/proactive/pending") {
        await next();
        return;
      }

      let args: unknown = undefined;
      if (method === "POST") {
        try {
          const cloned = c.req.raw.clone();
          const body = await cloned.json();
          args = Object.fromEntries(
            Object.entries(body as Record<string, unknown>).map(([k, v]) => {
              if (typeof v === "string" && v.length > 200) return [k, v.substring(0, 200) + "…"];
              return [k, v];
            }),
          );
        } catch { /* GET or unparseable body */ }
      }

      logger.info({ method, path, args }, "⚡ Tool call");
      await next();
      const ms = Date.now() - start;
      const status = c.res.status;

      try {
        const resClone = c.res.clone();
        const resBody = await resClone.json();
        const preview = JSON.stringify(resBody);
        const truncated = preview.length > 500 ? preview.substring(0, 500) + "…" : preview;
        logger.info({ path, status, ms, result: truncated }, "⚡ Tool done");
      } catch {
        logger.info({ path, status, ms }, "⚡ Tool done");
      }

      // Auto-audit: log every mutating tool call to audit_log
      if (method !== "GET" && deps && "vaultStore" in deps && deps.vaultStore) {
        try {
          const turnId = c.req.header("x-turn-id") ?? c.req.header("x-session-id") ?? null;
          deps.vaultStore.logAudit({
            sessionId: turnId,
            tool: path.replace(/^\//, "").replace(/\//g, "."),
            args: args != null ? JSON.stringify(args) : null,
            result: String(c.res.status),
            durationMs: ms,
            turnId,
            stepIndex: null,
          });
        } catch { /* non-blocking */ }
      }
    });
  }

  private mountRouters(deps: ToolServerDeps): void {
    const heartbeatRef = this.heartbeatRef;

    this.app.route("/", channelsRouter({
      registry: deps.registry,
      logger: deps.logger,
      pluginTools: deps.pluginTools,
    }));

    this.app.route("/", vaultRouter({
      vaultStore: deps.vaultStore,
      vaultSearch: deps.vaultSearch,
      sessionMap: deps.sessionMap,
    }));

    this.app.route("/", governanceRouter({
      governanceEngine: deps.governanceEngine,
      policyEngine: deps.policyEngine,
      vaultStore: deps.vaultStore,
      usageTracker: deps.usageTracker,
    }));

    this.app.route("/", intelligenceRouter({
      governanceEngine: deps.governanceEngine,
      vaultStore: deps.vaultStore,
      vaultSearch: deps.vaultSearch,
      sessionMap: deps.sessionMap,
      intelligenceStore: deps.intelligenceStore,
      goalLifecycle: deps.goalLifecycle,
      arcLifecycle: deps.arcLifecycle,
      arcDetector: deps.arcDetector,
      promptAssembler: deps.promptAssembler,
    }));

    this.app.route("/", systemRouter({
      logger: deps.logger,
      canvasServer: deps.canvasServer,
      intentStore: deps.intentStore,
      signalStore: deps.signalStore,
      vaultStore: deps.vaultStore,
      sessionMap: deps.sessionMap,
      heartbeatRef,
    }));

    this.app.route("/", skillsRouter({
      policyEngine: deps.policyEngine,
      cliRegistry: deps.cliRegistry,
    }));

    this.app.route("/", cliRouter({
      logger: deps.logger,
      cliExecutor: deps.cliExecutor,
      cliRegistry: deps.cliRegistry,
    }));
  }

  async start(): Promise<void> {
    this.server = serve({ fetch: this.app.fetch, port: this.port });
    this.logger.info({ port: this.port }, "Tool server started");
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.logger.info("Tool server stopped");
    }
  }

  setHeartbeatEngine(engine: HeartbeatEngine): void {
    this.heartbeatRef.engine = engine;
  }
}
