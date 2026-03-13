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
import { randomUUID } from "node:crypto";

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
  /** Idle window (ms) before a new turn ID is assigned. Default: 2000 */
  turnIdleWindowMs?: number;
}

export class ToolServer {
  private readonly app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private readonly logger: Logger;
  private readonly port: number;
  // Mutable ref so setHeartbeatEngine updates the systemRouter closure
  private readonly heartbeatRef: { engine: HeartbeatEngine | null };
  private readonly turnIdleWindowMs: number;

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
    this.turnIdleWindowMs = deps.turnIdleWindowMs ?? 2000;
    this.setupMiddleware(deps.logger, deps.vaultStore);
    this.mountRouters(deps);
  }

  // Per-session turn state for auto-instrumentation
  private readonly turnState = new Map<string, { turnId: string; stepIndex: number; lastMs: number }>();
  private turnStateTimer: ReturnType<typeof setInterval> | null = null;

  private startTurnStateEviction(): void {
    if (this.turnStateTimer) return;
    const TTL_MS = 30_000; // evict entries idle for >30s
    this.turnStateTimer = setInterval(() => {
      const cutoff = Date.now() - TTL_MS;
      for (const [key, val] of this.turnState) {
        if (val.lastMs < cutoff) this.turnState.delete(key);
      }
    }, TTL_MS);
    this.turnStateTimer.unref?.();
  }

  private setupMiddleware(logger: Logger, vaultStore?: import("../vault/store.js").VaultStore | null | undefined): void {
    if (vaultStore) this.startTurnStateEviction();

    this.app.use("*", async (c, next) => {
      const start = Date.now();
      const method = c.req.method;
      const path = c.req.path;

      if (path === "/session/system-context" || path === "/proactive/pending") {
        await next();
        return;
      }

      // Skip self-referential and read-only paths
      const skipInstrumentation = !vaultStore ||
        path.startsWith("/audit/") || path.startsWith("/traces") ||
        path.startsWith("/governance/") || path.startsWith("/usage/") ||
        path.startsWith("/health") || method === "GET";

      let parsedBody: Record<string, unknown> | null = null;
      let args: unknown = undefined;
      if (method === "POST") {
        try {
          const cloned = c.req.raw.clone();
          const body = await cloned.json();
          parsedBody = body as Record<string, unknown>;
          args = Object.fromEntries(
            Object.entries(body as Record<string, unknown>).map(([k, v]) => {
              if (typeof v === "string" && v.length > 200) return [k, v.substring(0, 200) + "…"];
              return [k, v];
            }),
          );
        } catch { /* GET or unparseable body */ }
      }

      // Compute turn state BEFORE await (no race condition)
      let auditPayload: null | import("../vault/store.js").LogAuditParams = null;
      if (!skipInstrumentation) {
        const sessionId = (parsedBody?.["sessionId"] as string | undefined) ??
          (parsedBody?.["sessionID"] as string | undefined) ?? null;
        // Skip if no sessionId — avoids "__global__" memory leak
        if (sessionId) {
          const now = start;
          let state = this.turnState.get(sessionId);
          if (!state || (now - state.lastMs) > this.turnIdleWindowMs) {
            state = { turnId: randomUUID(), stepIndex: 0, lastMs: now };
            this.turnState.set(sessionId, state);
          } else {
            state.stepIndex += 1;
            state.lastMs = now;
          }
          const { turnId, stepIndex } = state;
          const toolName = path.replace(/^\//, "").replace(/\//g, ".");
          const argsStr = parsedBody ? JSON.stringify(parsedBody) : null;
          auditPayload = {
            sessionId,
            tool: toolName,
            args: argsStr && argsStr.length > 500 ? argsStr.substring(0, 500) + "…" : argsStr,
            result: null,
            durationMs: 0,
            turnId,
            stepIndex,
          };
        }
      }

      logger.info({ method, path, args }, "⚡ Tool call");
      await next();
      const ms = Date.now() - start;
      const status = c.res.status;

      // Capture response once; reuse for both audit and logger
      let resultStr: string | null = null;
      try {
        const resClone = c.res.clone();
        const resBody = await resClone.json();
        const preview = JSON.stringify(resBody);
        resultStr = preview.length > 1000 ? preview.substring(0, 1000) + "…" : preview;
        logger.info({ path, status, ms, result: resultStr.substring(0, 500) }, "⚡ Tool done");
      } catch {
        logger.info({ path, status, ms }, "⚡ Tool done");
      }

      // Auto-instrumentation
      if (auditPayload) {
        try {
          auditPayload.result = resultStr;
          auditPayload.durationMs = ms;
          vaultStore!.logAudit(auditPayload);
        } catch { /* never block */ }
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
    if (this.turnStateTimer) {
      clearInterval(this.turnStateTimer);
      this.turnStateTimer = null;
    }
    this.turnState.clear();
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
