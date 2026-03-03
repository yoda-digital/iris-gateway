import { Hono } from "hono";
import type { VaultStore } from "../../vault/store.js";
import type { VaultSearch } from "../../vault/search.js";
import type { SessionMap } from "../session-map.js";

export interface VaultDeps {
  vaultStore?: VaultStore | null;
  vaultSearch?: VaultSearch | null;
  sessionMap?: SessionMap | null;
}

export function vaultRouter(deps: VaultDeps): Hono {
  const app = new Hono();
  const { vaultStore, vaultSearch, sessionMap } = deps;

  app.post("/vault/search", async (c) => {
    if (!vaultSearch) return c.json({ error: "Vault not configured" }, 503);
    const body = await c.req.json();
    const results = vaultSearch.search(
      body.query ?? "",
      { senderId: body.senderId, channelId: body.channelId, type: body.type, limit: body.limit },
    );
    return c.json({ results });
  });

  app.post("/vault/store", async (c) => {
    if (!vaultStore) return c.json({ error: "Vault not configured" }, 503);
    const body = await c.req.json();
    const id = vaultStore.addMemory({
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

  app.delete("/vault/memory/:id", async (c) => {
    if (!vaultStore) return c.json({ error: "Vault not configured" }, 503);
    const deleted = vaultStore.deleteMemory(c.req.param("id"));
    return c.json({ deleted });
  });

  app.post("/vault/context", async (c) => {
    if (!vaultStore || !vaultSearch) return c.json({ profile: null, memories: [] });
    const body = await c.req.json();
    let senderId = body.senderId ?? null;
    let channelId = body.channelId ?? null;

    if (!senderId && body.sessionID && sessionMap) {
      const entry = await sessionMap.findBySessionId(body.sessionID);
      if (entry) { senderId = entry.senderId; channelId = entry.channelId; }
    }

    const profile = senderId && channelId ? vaultStore.getProfile(senderId, channelId) : null;
    const memories = senderId ? vaultSearch.search("", { senderId, limit: 10 }) : [];
    return c.json({ profile, memories });
  });

  app.post("/vault/extract", async (_c) => {
    return _c.json({ facts: [] });
  });

  app.post("/vault/store-batch", async (c) => {
    if (!vaultStore) return c.json({ ids: [] });
    const body = await c.req.json();
    const memories = body.memories ?? [];
    const ids: string[] = [];
    for (const mem of memories) {
      const id = vaultStore.addMemory({
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

  app.post("/vault/profile", async (c) => {
    if (!vaultStore) return c.json({ ok: false });
    const body = await c.req.json();
    if (!body.senderId || !body.channelId) {
      return c.json({ error: "senderId and channelId required" }, 400);
    }
    vaultStore.upsertProfile({
      senderId: body.senderId,
      channelId: body.channelId,
      name: body.name ?? null,
      timezone: body.timezone ?? null,
      language: body.language ?? null,
      preferences: body.preferences,
    });
    return c.json({ ok: true });
  });

  return app;
}
