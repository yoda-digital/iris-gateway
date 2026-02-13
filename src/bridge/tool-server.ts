import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ChannelRegistry } from "../channels/registry.js";
import type { Logger } from "../logging/logger.js";
import type { VaultStore } from "../vault/store.js";
import type { VaultSearch } from "../vault/search.js";
import type { GovernanceEngine } from "../governance/engine.js";
import type { SessionMap } from "./session-map.js";
import type { PluginToolDef } from "../plugins/types.js";
import type { UsageTracker } from "../usage/tracker.js";
import type { CanvasServer } from "../canvas/server.js";

const sendMessageSchema = z.object({
  channel: z.string().min(1),
  to: z.string().min(1),
  text: z.string().min(1),
  replyToId: z.string().optional(),
});

const sendMediaSchema = z.object({
  channel: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(["image", "video", "audio", "document"]),
  url: z.string().min(1),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  caption: z.string().optional(),
});

const channelActionSchema = z.object({
  channel: z.string().min(1),
  action: z.enum(["typing", "react", "edit", "delete"]),
  chatId: z.string().min(1),
  messageId: z.string().optional(),
  emoji: z.string().optional(),
  text: z.string().optional(),
});

const userInfoSchema = z.object({
  channel: z.string().min(1),
  userId: z.string().min(1),
});

export interface ToolServerDeps {
  registry: ChannelRegistry;
  logger: Logger;
  port?: number;
  vaultStore?: VaultStore | null;
  vaultSearch?: VaultSearch | null;
  governanceEngine?: GovernanceEngine | null;
  sessionMap?: SessionMap | null;
  pluginTools?: Map<string, PluginToolDef> | null;
  usageTracker?: UsageTracker | null;
  canvasServer?: CanvasServer | null;
}

export class ToolServer {
  private readonly app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private readonly registry: ChannelRegistry;
  private readonly logger: Logger;
  private readonly port: number;
  private readonly vaultStore: VaultStore | null;
  private readonly vaultSearch: VaultSearch | null;
  private readonly governanceEngine: GovernanceEngine | null;
  private readonly sessionMap: SessionMap | null;
  private readonly pluginTools: Map<string, PluginToolDef> | null;
  private readonly usageTracker: UsageTracker | null;
  private readonly canvasServer: CanvasServer | null;

  constructor(deps: ToolServerDeps);
  constructor(registry: ChannelRegistry, logger: Logger, port?: number);
  constructor(
    registryOrDeps: ChannelRegistry | ToolServerDeps,
    logger?: Logger,
    port?: number,
  ) {
    if (logger !== undefined) {
      // Legacy 3-arg constructor
      this.registry = registryOrDeps as ChannelRegistry;
      this.logger = logger;
      this.port = port ?? 19877;
      this.vaultStore = null;
      this.vaultSearch = null;
      this.governanceEngine = null;
      this.sessionMap = null;
      this.pluginTools = null;
      this.usageTracker = null;
      this.canvasServer = null;
    } else {
      const deps = registryOrDeps as ToolServerDeps;
      this.registry = deps.registry;
      this.logger = deps.logger;
      this.port = deps.port ?? 19877;
      this.vaultStore = deps.vaultStore ?? null;
      this.vaultSearch = deps.vaultSearch ?? null;
      this.governanceEngine = deps.governanceEngine ?? null;
      this.sessionMap = deps.sessionMap ?? null;
      this.pluginTools = deps.pluginTools ?? null;
      this.usageTracker = deps.usageTracker ?? null;
      this.canvasServer = deps.canvasServer ?? null;
    }
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.post("/tool/send-message", async (c) => {
      const parsed = sendMessageSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
      }
      const body = parsed.data;
      const adapter = this.registry.get(body.channel);
      if (!adapter) {
        return c.json({ error: `Channel not found: ${body.channel}` }, 404);
      }
      try {
        const result = await adapter.sendText({
          to: body.to,
          text: body.text,
          replyToId: body.replyToId,
        });
        return c.json(result);
      } catch (err) {
        this.logger.error({ err, channel: body.channel }, "Tool send-message failed");
        return c.json({ error: String(err) }, 500);
      }
    });

    this.app.post("/tool/send-media", async (c) => {
      const parsed = sendMediaSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
      }
      const body = parsed.data;
      const adapter = this.registry.get(body.channel);
      if (!adapter) {
        return c.json({ error: `Channel not found: ${body.channel}` }, 404);
      }
      if (!adapter.sendMedia) {
        return c.json({ error: "Channel does not support media" }, 400);
      }
      try {
        const result = await adapter.sendMedia({
          to: body.to,
          type: body.type,
          source: body.url,
          mimeType: body.mimeType ?? "application/octet-stream",
          filename: body.filename,
          caption: body.caption,
        });
        return c.json(result);
      } catch (err) {
        this.logger.error({ err, channel: body.channel }, "Tool send-media failed");
        return c.json({ error: String(err) }, 500);
      }
    });

    this.app.post("/tool/channel-action", async (c) => {
      const parsed = channelActionSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
      }
      const body = parsed.data;
      const adapter = this.registry.get(body.channel);
      if (!adapter) {
        return c.json({ error: `Channel not found: ${body.channel}` }, 404);
      }

      try {
        switch (body.action) {
          case "typing":
            if (!adapter.sendTyping) {
              return c.json({ error: "Channel does not support typing" }, 400);
            }
            await adapter.sendTyping({ to: body.chatId });
            return c.json({ ok: true });
          case "react":
            if (!body.messageId || !body.emoji) {
              return c.json({ error: "react requires messageId and emoji" }, 400);
            }
            if (!adapter.sendReaction) {
              return c.json({ error: "Channel does not support reactions" }, 400);
            }
            await adapter.sendReaction({ messageId: body.messageId, emoji: body.emoji, chatId: body.chatId });
            return c.json({ ok: true });
          case "edit":
            if (!body.messageId || !body.text) {
              return c.json({ error: "edit requires messageId and text" }, 400);
            }
            if (!adapter.editMessage) {
              return c.json({ error: "Channel does not support edit" }, 400);
            }
            await adapter.editMessage({ messageId: body.messageId, text: body.text, chatId: body.chatId });
            return c.json({ ok: true });
          case "delete":
            if (!body.messageId) {
              return c.json({ error: "delete requires messageId" }, 400);
            }
            if (!adapter.deleteMessage) {
              return c.json({ error: "Channel does not support delete" }, 400);
            }
            await adapter.deleteMessage({ messageId: body.messageId, chatId: body.chatId });
            return c.json({ ok: true });
        }
      } catch (err) {
        this.logger.error({ err, channel: body.channel, action: body.action }, "Tool channel-action failed");
        return c.json({ error: String(err) }, 500);
      }
    });

    this.app.post("/tool/user-info", async (c) => {
      const parsed = userInfoSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
      }
      const body = parsed.data;
      const adapter = this.registry.get(body.channel);
      if (!adapter) {
        return c.json({ error: `Channel not found: ${body.channel}` }, 404);
      }
      return c.json({
        channel: body.channel,
        userId: body.userId,
        capabilities: adapter.capabilities,
      });
    });

    this.app.get("/tool/list-channels", (c) => {
      const channels = this.registry.list().map((a) => ({
        id: a.id,
        label: a.label,
        capabilities: a.capabilities,
      }));
      return c.json({ channels });
    });

    // ── Plugin tool endpoints ──

    this.app.post("/tool/plugin/:name", async (c) => {
      const name = c.req.param("name");
      const toolDef = this.pluginTools?.get(name);
      if (!toolDef) return c.json({ error: `Plugin tool not found: ${name}` }, 404);
      const body = await c.req.json();
      try {
        const result = await toolDef.execute(body, {
          sessionId: body.sessionId ?? null,
          senderId: body.senderId ?? null,
          channelId: body.channelId ?? null,
          logger: this.logger,
        });
        return c.json(result ?? { ok: true });
      } catch (err) {
        this.logger.error({ err, tool: name }, "Plugin tool execution failed");
        return c.json({ error: String(err) }, 500);
      }
    });

    this.app.get("/tool/plugin-manifest", (c) => {
      if (!this.pluginTools || this.pluginTools.size === 0) {
        return c.json({ tools: {} });
      }
      const tools: Record<string, { description: string }> = {};
      for (const [name, def] of this.pluginTools) {
        tools[name] = { description: def.description };
      }
      return c.json({ tools });
    });

    // ── Vault endpoints ──

    this.app.post("/vault/search", async (c) => {
      if (!this.vaultSearch) return c.json({ error: "Vault not configured" }, 503);
      const body = await c.req.json();
      const results = this.vaultSearch.search(
        body.query ?? "",
        { senderId: body.senderId, channelId: body.channelId, type: body.type, limit: body.limit },
      );
      return c.json({ results });
    });

    this.app.post("/vault/store", async (c) => {
      if (!this.vaultStore) return c.json({ error: "Vault not configured" }, 503);
      const body = await c.req.json();
      const id = this.vaultStore.addMemory({
        sessionId: body.sessionId ?? "unknown",
        channelId: body.channelId ?? null,
        senderId: body.senderId ?? null,
        type: body.type ?? "fact",
        content: body.content,
        source: body.source ?? "system",
        confidence: body.confidence,
        expiresAt: body.expiresAt,
      });
      return c.json({ id });
    });

    this.app.delete("/vault/memory/:id", async (c) => {
      if (!this.vaultStore) return c.json({ error: "Vault not configured" }, 503);
      const deleted = this.vaultStore.deleteMemory(c.req.param("id"));
      return c.json({ deleted });
    });

    this.app.post("/vault/context", async (c) => {
      if (!this.vaultStore || !this.vaultSearch) {
        return c.json({ profile: null, memories: [] });
      }
      const body = await c.req.json();
      // Accept senderId/channelId directly, or resolve from sessionID via session map
      let senderId = body.senderId ?? null;
      let channelId = body.channelId ?? null;

      // Reverse-lookup: plugin hook only has sessionID, resolve to sender
      if (!senderId && body.sessionID && this.sessionMap) {
        const entry = await this.sessionMap.findBySessionId(body.sessionID);
        if (entry) {
          senderId = entry.senderId;
          channelId = entry.channelId;
        }
      }

      const profile = senderId && channelId
        ? this.vaultStore.getProfile(senderId, channelId)
        : null;
      const memories = senderId
        ? this.vaultSearch.search("", { senderId, limit: 10 })
        : [];
      return c.json({ profile, memories });
    });

    this.app.post("/vault/extract", async (c) => {
      // Lightweight fact extraction from conversation context.
      // For now, returns empty — a real implementation would use an LLM
      // to parse context into structured facts. The hook handles the
      // "no facts" case gracefully.
      return c.json({ facts: [] });
    });

    this.app.post("/vault/store-batch", async (c) => {
      if (!this.vaultStore) return c.json({ ids: [] });
      const body = await c.req.json();
      const memories = body.memories ?? [];
      const ids: string[] = [];
      for (const mem of memories) {
        const id = this.vaultStore.addMemory({
          sessionId: body.sessionID ?? body.sessionId ?? "unknown",
          channelId: mem.channelId ?? null,
          senderId: mem.senderId ?? null,
          type: mem.type ?? "insight",
          content: mem.content,
          source: "extracted",
        });
        ids.push(id);
      }
      return c.json({ ids });
    });

    this.app.post("/vault/profile", async (c) => {
      if (!this.vaultStore) return c.json({ ok: false });
      const body = await c.req.json();
      if (!body.senderId || !body.channelId) {
        return c.json({ error: "senderId and channelId required" }, 400);
      }
      this.vaultStore.upsertProfile({
        senderId: body.senderId,
        channelId: body.channelId,
        name: body.name ?? null,
        timezone: body.timezone ?? null,
        language: body.language ?? null,
        preferences: body.preferences,
      });
      return c.json({ ok: true });
    });

    // ── Governance endpoints ──

    this.app.get("/governance/rules", (c) => {
      if (!this.governanceEngine) return c.json({ rules: [], directives: "" });
      return c.json({
        rules: this.governanceEngine.getRules(),
        directives: this.governanceEngine.getDirectivesBlock(),
      });
    });

    this.app.post("/governance/evaluate", async (c) => {
      if (!this.governanceEngine) return c.json({ allowed: true });
      const body = await c.req.json();
      const result = this.governanceEngine.evaluate(body.tool ?? "", body.args ?? {});

      // Log the governance decision
      if (this.vaultStore) {
        this.vaultStore.logGovernance({
          sessionId: body.sessionID ?? body.sessionId ?? null,
          tool: body.tool ?? null,
          ruleId: result.ruleId ?? null,
          action: result.allowed ? "allowed" : "blocked",
          reason: result.reason ?? null,
        });
      }

      return c.json(result);
    });

    // ── Audit endpoint ──

    this.app.post("/audit/log", async (c) => {
      if (!this.vaultStore) return c.json({ ok: true });
      const body = await c.req.json();
      this.vaultStore.logAudit({
        sessionId: body.sessionID ?? body.sessionId ?? null,
        tool: body.tool ?? "unknown",
        args: typeof body.args === "string" ? body.args : JSON.stringify(body.args ?? null),
        result: typeof body.result === "string" ? body.result : JSON.stringify(body.result ?? null),
        durationMs: body.durationMs ?? null,
      });
      return c.json({ ok: true });
    });

    // ── Usage endpoints ──

    this.app.post("/usage/record", async (c) => {
      if (!this.usageTracker) return c.json({ error: "Usage tracking not configured" }, 503);
      const body = await c.req.json();
      const id = this.usageTracker.record({
        sessionId: body.sessionId ?? body.sessionID ?? null,
        senderId: body.senderId ?? null,
        channelId: body.channelId ?? null,
        modelId: body.modelId ?? null,
        providerId: body.providerId ?? null,
        tokensInput: body.tokensInput ?? 0,
        tokensOutput: body.tokensOutput ?? 0,
        tokensReasoning: body.tokensReasoning ?? 0,
        tokensCacheRead: body.tokensCacheRead ?? 0,
        tokensCacheWrite: body.tokensCacheWrite ?? 0,
        costUsd: body.costUsd ?? 0,
        durationMs: body.durationMs ?? null,
      });
      return c.json({ id });
    });

    this.app.post("/usage/summary", async (c) => {
      if (!this.usageTracker) return c.json({ error: "Usage tracking not configured" }, 503);
      const body = await c.req.json().catch(() => ({}));
      const summary = this.usageTracker.summarize({
        senderId: body.senderId,
        since: body.since,
        until: body.until,
      });
      return c.json(summary);
    });

    // ── Canvas endpoints ──

    this.app.post("/canvas/update", async (c) => {
      if (!this.canvasServer) return c.json({ error: "Canvas not configured" }, 503);
      const body = await c.req.json();
      const sessionId = body.sessionId ?? "default";
      if (body.component) {
        this.canvasServer.updateComponent(sessionId, body.component);
      }
      if (body.clear) {
        this.canvasServer.getSession(sessionId).clearComponents();
      }
      if (body.remove) {
        this.canvasServer.getSession(sessionId).removeComponent(body.remove);
      }
      return c.json({ ok: true });
    });

    // ── Skill CRUD endpoints ──

    const skillsDir = resolve(process.cwd(), ".opencode", "skills");
    const agentsDir = resolve(process.cwd(), ".opencode", "agents");

    this.app.post("/skills/create", async (c) => {
      const body = await c.req.json();
      const name = body.name as string;
      if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
        return c.json({ error: "Invalid skill name (lowercase, dashes, starts with letter)" }, 400);
      }
      const dir = join(skillsDir, name);
      mkdirSync(dir, { recursive: true });
      const content = [
        "---",
        `name: ${name}`,
        `description: ${body.description ?? ""}`,
        "---",
        "",
        body.content ?? "",
      ].join("\n");
      writeFileSync(join(dir, "SKILL.md"), content);
      return c.json({ ok: true, path: join(dir, "SKILL.md") });
    });

    this.app.get("/skills/list", (c) => {
      if (!existsSync(skillsDir)) return c.json({ skills: [] });
      const skills: Array<{ name: string; path: string; description: string }> = [];
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const skillFile = join(skillsDir, entry.name, "SKILL.md");
        let description = "";
        if (existsSync(skillFile)) {
          const raw = readFileSync(skillFile, "utf-8");
          const match = raw.match(/description:\s*(.+)/);
          if (match) description = match[1].trim();
        }
        skills.push({ name: entry.name, path: skillFile, description });
      }
      return c.json({ skills });
    });

    this.app.post("/skills/delete", async (c) => {
      const body = await c.req.json();
      const name = body.name as string;
      if (!name) return c.json({ error: "name required" }, 400);
      const dir = join(skillsDir, name);
      if (!existsSync(dir)) return c.json({ error: "Skill not found" }, 404);
      rmSync(dir, { recursive: true, force: true });
      return c.json({ ok: true });
    });

    this.app.post("/skills/validate", async (c) => {
      const body = await c.req.json();
      const name = body.name as string;
      if (!name) return c.json({ valid: false, error: "name required" });
      const dir = join(skillsDir, name);
      const skillFile = join(dir, "SKILL.md");
      if (!existsSync(skillFile)) return c.json({ valid: false, error: "SKILL.md not found" });
      const raw = readFileSync(skillFile, "utf-8");
      const hasFrontmatter = raw.startsWith("---") && raw.indexOf("---", 3) > 3;
      if (!hasFrontmatter) return c.json({ valid: false, error: "Missing YAML frontmatter" });
      return c.json({ valid: true });
    });

    // ── Agent CRUD endpoints ──

    this.app.post("/agents/create", async (c) => {
      const body = await c.req.json();
      const name = body.name as string;
      if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
        return c.json({ error: "Invalid agent name (lowercase, dashes, starts with letter)" }, 400);
      }
      mkdirSync(agentsDir, { recursive: true });
      const frontmatter = [
        "---",
        body.mode ? `mode: ${body.mode}` : "mode: subagent",
        body.model ? `model: ${body.model}` : "",
        body.temperature != null ? `temperature: ${body.temperature}` : "",
        body.tools?.length ? `tools: [${body.tools.join(", ")}]` : "",
        "---",
      ].filter(Boolean).join("\n");
      const content = `${frontmatter}\n\n${body.prompt ?? `You are the ${name} agent.`}\n`;
      writeFileSync(join(agentsDir, `${name}.md`), content);
      return c.json({ ok: true, path: join(agentsDir, `${name}.md`) });
    });

    this.app.get("/agents/list", (c) => {
      if (!existsSync(agentsDir)) return c.json({ agents: [] });
      const agents: Array<{ name: string; path: string; mode: string }> = [];
      for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const agentPath = join(agentsDir, entry.name);
        const raw = readFileSync(agentPath, "utf-8");
        const modeMatch = raw.match(/mode:\s*(\w+)/);
        agents.push({
          name: entry.name.replace(/\.md$/, ""),
          path: agentPath,
          mode: modeMatch?.[1] ?? "unknown",
        });
      }
      return c.json({ agents });
    });

    this.app.post("/agents/delete", async (c) => {
      const body = await c.req.json();
      const name = body.name as string;
      if (!name) return c.json({ error: "name required" }, 400);
      const agentFile = join(agentsDir, `${name}.md`);
      if (!existsSync(agentFile)) return c.json({ error: "Agent not found" }, 404);
      rmSync(agentFile);
      return c.json({ ok: true });
    });

    this.app.post("/agents/validate", async (c) => {
      const body = await c.req.json();
      const name = body.name as string;
      if (!name) return c.json({ valid: false, error: "name required" });
      const agentFile = join(agentsDir, `${name}.md`);
      if (!existsSync(agentFile)) return c.json({ valid: false, error: "Agent file not found" });
      const raw = readFileSync(agentFile, "utf-8");
      const hasFrontmatter = raw.startsWith("---") && raw.indexOf("---", 3) > 3;
      if (!hasFrontmatter) return c.json({ valid: false, error: "Missing YAML frontmatter" });
      const hasMode = /mode:\s*\w+/.test(raw);
      if (!hasMode) return c.json({ valid: false, error: "Missing mode in frontmatter" });
      return c.json({ valid: true });
    });

    // ── Session context for system prompt injection ──

    this.app.post("/session/system-context", async (c) => {
      const directives = this.governanceEngine?.getDirectivesBlock() ?? "";
      const body = await c.req.json().catch(() => ({}));
      // Return governance directives and any available context
      return c.json({
        directives,
        channelRules: null,
        userContext: null,
      });
    });
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
}
