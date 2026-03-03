import { Hono } from "hono";
import type { Logger } from "../../logging/logger.js";
import type { CanvasServer } from "../../canvas/server.js";
import type { IntentStore } from "../../proactive/store.js";
import type { SignalStore } from "../../onboarding/signals.js";
import type { VaultStore } from "../../vault/store.js";
import type { SessionMap } from "../session-map.js";

type HeartbeatEngine = { getStatus(): Array<{ agentId: string; component: string; status: string }> };

export interface SystemDeps {
  logger: Logger;
  canvasServer?: CanvasServer | null;
  intentStore?: IntentStore | null;
  signalStore?: SignalStore | null;
  vaultStore?: VaultStore | null;
  sessionMap?: SessionMap | null;
  heartbeatRef: { engine: HeartbeatEngine | null };
}

export function systemRouter(deps: SystemDeps): Hono {
  const app = new Hono();
  const { logger, canvasServer, intentStore, signalStore, vaultStore, sessionMap, heartbeatRef } = deps;

  // ── Canvas ──
  app.post("/canvas/update", async (c) => {
    if (!canvasServer) return c.json({ error: "Canvas not configured" }, 503);
    const body = await c.req.json();
    const sessionId = body.sessionId ?? "default";
    if (body.component) canvasServer.updateComponent(sessionId, body.component);
    if (body.clear) canvasServer.getSession(sessionId).clearComponents();
    if (body.remove) canvasServer.getSession(sessionId).removeComponent(body.remove);
    return c.json({ ok: true });
  });

  // ── Proactive ──
  app.post("/proactive/intent", async (c) => {
    if (!intentStore) return c.json({ error: "Proactive not enabled" }, 503);
    const body = await c.req.json();
    const sessionId = body.sessionID ?? body.sessionId ?? "";
    let channelId = body.channelId ?? "";
    let chatId = body.chatId ?? "";
    let senderId = body.senderId ?? "";
    if (sessionId && sessionMap && (!channelId || !senderId)) {
      const entry = await sessionMap.findBySessionId(sessionId);
      if (entry) {
        channelId = channelId || entry.channelId;
        chatId = chatId || entry.chatId;
        senderId = senderId || entry.senderId;
      }
    }
    const id = intentStore.addIntent({
      sessionId, channelId, chatId, senderId,
      what: body.what ?? "",
      why: body.why ?? null,
      confidence: body.confidence ?? 0.8,
      executeAt: Date.now() + (body.delayMs ?? 86_400_000),
      category: body.category,
    });
    return c.json({ id });
  });

  app.post("/proactive/cancel", async (c) => {
    if (!intentStore) return c.json({ error: "Proactive not enabled" }, 503);
    const body = await c.req.json();
    return c.json({ ok: intentStore.cancelIntent(body.id ?? "") });
  });

  app.get("/proactive/pending", (c) => {
    if (!intentStore) return c.json({ intents: [], triggers: [] });
    const limit = Number(c.req.query("limit")) || 20;
    return c.json(intentStore.listAllPending(limit));
  });

  app.get("/proactive/quota", (c) => {
    if (!intentStore) return c.json({ allowed: true, sentToday: 0, limit: 999, engagementRate: 0 });
    return c.json(intentStore.getQuotaStatus(
      c.req.query("senderId") ?? "",
      c.req.query("channelId") ?? "",
      3,
    ));
  });

  app.post("/proactive/scan", async (c) => {
    if (!intentStore) return c.json({ error: "Proactive not enabled" }, 503);
    const body = await c.req.json().catch(() => ({}));
    return c.json({ users: intentStore.listDormantUsers(body.thresholdMs ?? 604_800_000, 10) });
  });

  app.post("/proactive/execute", async (c) => {
    if (!intentStore) return c.json({ error: "Proactive not enabled" }, 503);
    const body = await c.req.json();
    intentStore.markIntentExecuted(body.id ?? "", "manual_trigger");
    return c.json({ ok: true });
  });

  app.post("/proactive/engage", async (c) => {
    if (!intentStore) return c.json({ error: "Proactive not enabled" }, 503);
    const body = await c.req.json();
    intentStore.markEngaged(body.senderId ?? "", body.channelId ?? "");
    return c.json({ ok: true });
  });

  // ── Onboarding ──
  app.post("/onboarding/enrich", async (c) => {
    if (!signalStore) return c.json({ error: "Onboarding not configured" }, 503);
    const body = await c.req.json();
    const field = body.field as string;
    const value = body.value as string;
    if (!field || !value) return c.json({ error: "field and value required" }, 400);

    const confidence = typeof body.confidence === "number" ? body.confidence : 0.9;
    let senderId: string | null = null;
    let channelId: string | null = null;
    if (body.sessionID && sessionMap) {
      const entry = await sessionMap.findBySessionId(body.sessionID);
      if (entry) { senderId = entry.senderId; channelId = entry.channelId; }
    }
    if (!senderId || !channelId) return c.json({ error: "Could not resolve sender from session" }, 400);

    signalStore.addSignal({ senderId, channelId, signalType: field, value, confidence });

    if (["name", "language", "timezone"].includes(field) && vaultStore) {
      vaultStore.upsertProfile({ senderId, channelId, [field]: value });
    }

    logger.debug({ senderId, field, value, confidence }, "Profile enriched via LLM");
    return c.json({ ok: true });
  });

  // ── Heartbeat ──
  app.get("/heartbeat/status", (c) => {
    const engine = heartbeatRef.engine;
    if (!engine) return c.json({ enabled: false, components: [] });
    return c.json({ enabled: true, components: engine.getStatus() });
  });

  app.post("/heartbeat/trigger", async (c) => {
    const engine = heartbeatRef.engine;
    if (!engine) return c.json({ error: "Heartbeat not enabled" }, 503);
    try {
      await (engine as any).tick();
      return c.json({ ok: true, components: engine.getStatus() });
    } catch (_err) {
      return c.json({ error: "Trigger failed" }, 500);
    }
  });

  return app;
}
