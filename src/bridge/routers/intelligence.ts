import { Hono } from "hono";
import type { GovernanceEngine } from "../../governance/engine.js";
import type { VaultStore } from "../../vault/store.js";
import type { VaultSearch } from "../../vault/search.js";
import type { SessionMap } from "../session-map.js";
import type { IntelligenceStore } from "../../intelligence/store.js";
import type { GoalLifecycle } from "../../intelligence/goals/lifecycle.js";
import type { ArcLifecycle } from "../../intelligence/arcs/lifecycle.js";
import type { ArcDetector } from "../../intelligence/arcs/detector.js";
import type { PromptAssembler } from "../../intelligence/prompt-assembler.js";

export interface IntelligenceDeps {
  governanceEngine?: GovernanceEngine | null;
  vaultStore?: VaultStore | null;
  vaultSearch?: VaultSearch | null;
  sessionMap?: SessionMap | null;
  intelligenceStore?: IntelligenceStore | null;
  goalLifecycle?: GoalLifecycle | null;
  arcLifecycle?: ArcLifecycle | null;
  arcDetector?: ArcDetector | null;
  promptAssembler?: PromptAssembler | null;
}

export function intelligenceRouter(deps: IntelligenceDeps): Hono {
  const app = new Hono();
  const {
    governanceEngine, vaultStore, vaultSearch, sessionMap,
    intelligenceStore, goalLifecycle, arcLifecycle, arcDetector, promptAssembler,
  } = deps;

  // ── Session context for system prompt injection ──
  app.post("/session/system-context", async (c) => {
    const directives = governanceEngine?.getDirectivesBlock() ?? "";
    const body = await c.req.json().catch(() => ({}));

    let userContext: string | null = null;
    let channelRules: string | null = null;
    if (vaultStore && vaultSearch && body.sessionID && sessionMap) {
      const entry = await sessionMap.findBySessionId(body.sessionID);
      if (entry) {
        const profile = vaultStore.getProfile(entry.senderId, entry.channelId);
        const memories = vaultSearch.search("", { senderId: entry.senderId, limit: 10 });
        const blocks: string[] = [];
        if (profile) {
          blocks.push(`[User: ${profile.name ?? "unknown"} | ${profile.timezone ?? ""} | ${profile.language ?? ""}]`);
        }
        if (memories?.length > 0) {
          blocks.push(`[Relevant memories:\n${memories.map((m: { content: string }) => `- ${m.content}`).join("\n")}]`);
        }
        if (blocks.length > 0) userContext = blocks.join("\n");

        channelRules = `[CURRENT SESSION] channel=${entry.channelId} chatId=${entry.chatId} senderId=${entry.senderId} chatType=${entry.chatType}\nYour response text is automatically delivered to this chat. Only use send_message for cross-channel messaging or proactive outreach to OTHER users/channels.`;
      }
    }

    let intelligenceContext: string | null = null;
    if (promptAssembler && sessionMap && body.sessionID) {
      const resolvedEntry = await sessionMap.findBySessionId(body.sessionID);
      if (resolvedEntry) {
        intelligenceContext = promptAssembler.render(resolvedEntry.senderId);
      }
    }

    return c.json({ directives, channelRules, userContext, intelligenceContext });
  });

  // ── Goals ──
  app.post("/goals/create", async (c) => {
    if (!goalLifecycle) return c.json({ error: "Intelligence not enabled" }, 503);
    const body = await c.req.json();
    const sessionId = body.sessionID ?? body.sessionId ?? "";
    let senderId = body.senderId ?? "";
    let channelId = body.channelId ?? "";
    if (sessionId && sessionMap && (!senderId || !channelId)) {
      const entry = await sessionMap.findBySessionId(sessionId);
      if (entry) { senderId = senderId || entry.senderId; channelId = channelId || entry.channelId; }
    }
    const goal = goalLifecycle.create({
      senderId, channelId,
      description: body.description ?? "",
      arcId: body.arcId ?? undefined,
      successCriteria: body.successCriteria ?? undefined,
      nextAction: body.nextAction ?? undefined,
      nextActionDue: body.nextActionDue ?? undefined,
      priority: body.priority ?? undefined,
    });
    return c.json(goal);
  });

  app.post("/goals/update", async (c) => {
    if (!goalLifecycle) return c.json({ error: "Intelligence not enabled" }, 503);
    const body = await c.req.json();
    const updated = goalLifecycle.progress(body.id ?? "", body.progressNote ?? "", body.nextAction ?? undefined, body.nextActionDue ?? undefined);
    if (!updated) return c.json({ error: "Goal not found" }, 404);
    return c.json(updated);
  });

  app.post("/goals/complete", async (c) => {
    if (!goalLifecycle) return c.json({ error: "Intelligence not enabled" }, 503);
    const body = await c.req.json();
    const result = goalLifecycle.transition(body.id ?? "", "completed");
    if (!result) return c.json({ error: "Goal not found or invalid transition" }, 400);
    return c.json(result);
  });

  app.post("/goals/pause", async (c) => {
    if (!goalLifecycle) return c.json({ error: "Intelligence not enabled" }, 503);
    const body = await c.req.json();
    const result = goalLifecycle.transition(body.id ?? "", "paused");
    if (!result) return c.json({ error: "Goal not found or invalid transition" }, 400);
    return c.json(result);
  });

  app.post("/goals/resume", async (c) => {
    if (!goalLifecycle) return c.json({ error: "Intelligence not enabled" }, 503);
    const body = await c.req.json();
    const result = goalLifecycle.transition(body.id ?? "", "active");
    if (!result) return c.json({ error: "Goal not found or invalid transition" }, 400);
    return c.json(result);
  });

  app.post("/goals/abandon", async (c) => {
    if (!goalLifecycle) return c.json({ error: "Intelligence not enabled" }, 503);
    const body = await c.req.json();
    const result = goalLifecycle.transition(body.id ?? "", "abandoned");
    if (!result) return c.json({ error: "Goal not found or invalid transition" }, 400);
    return c.json(result);
  });

  app.post("/goals/list", async (c) => {
    if (!goalLifecycle) return c.json({ active: [], paused: [] });
    const body = await c.req.json();
    const sessionId = body.sessionID ?? body.sessionId ?? "";
    let senderId = body.senderId ?? "";
    if (sessionId && sessionMap && !senderId) {
      const entry = await sessionMap.findBySessionId(sessionId);
      if (entry) senderId = entry.senderId;
    }
    if (!senderId) return c.json({ active: [], paused: [] });
    return c.json(goalLifecycle.listGoals(senderId));
  });

  // ── Arcs ──
  app.post("/arcs/list", async (c) => {
    if (!arcLifecycle || !intelligenceStore) return c.json({ arcs: [] });
    const body = await c.req.json();
    const sessionId = body.sessionID ?? body.sessionId ?? "";
    let senderId = body.senderId ?? "";
    if (sessionId && sessionMap && !senderId) {
      const entry = await sessionMap.findBySessionId(sessionId);
      if (entry) senderId = entry.senderId;
    }
    if (!senderId) return c.json({ arcs: [] });
    return c.json({ arcs: intelligenceStore.getArcsBySender(senderId) });
  });

  app.post("/arcs/resolve", async (c) => {
    if (!arcLifecycle) return c.json({ error: "Intelligence not enabled" }, 503);
    const body = await c.req.json();
    arcLifecycle.resolve(body.id ?? "", body.summary ?? undefined);
    return c.json({ ok: true });
  });

  app.post("/arcs/add-memory", async (c) => {
    if (!arcDetector) return c.json({ error: "Intelligence not enabled" }, 503);
    const body = await c.req.json();
    const sessionId = body.sessionID ?? body.sessionId ?? "";
    let senderId = body.senderId ?? "";
    if (sessionId && sessionMap && !senderId) {
      const entry = await sessionMap.findBySessionId(sessionId);
      if (entry) senderId = entry.senderId;
    }
    if (!senderId) return c.json({ error: "Could not resolve sender" }, 400);
    arcDetector.processMemory(senderId, body.content ?? "", body.memoryId, body.source ?? "tool");
    return c.json({ ok: true });
  });

  return app;
}
