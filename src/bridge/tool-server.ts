import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import type { ChannelRegistry } from "../channels/registry.js";
import type { Logger } from "../logging/logger.js";
import type { VaultStore } from "../vault/store.js";
import type { VaultSearch } from "../vault/search.js";
import type { GovernanceEngine } from "../governance/engine.js";
import type { SessionMap } from "./session-map.js";

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
    } else {
      const deps = registryOrDeps as ToolServerDeps;
      this.registry = deps.registry;
      this.logger = deps.logger;
      this.port = deps.port ?? 19877;
      this.vaultStore = deps.vaultStore ?? null;
      this.vaultSearch = deps.vaultSearch ?? null;
      this.governanceEngine = deps.governanceEngine ?? null;
      this.sessionMap = deps.sessionMap ?? null;
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
