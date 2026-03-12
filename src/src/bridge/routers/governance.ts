import { Hono } from "hono";
import type { GovernanceEngine } from "../../governance/engine.js";
import type { PolicyEngine } from "../../governance/policy.js";
import type { VaultStore } from "../../vault/store.js";
import type { UsageTracker } from "../../usage/tracker.js";

export interface GovernanceDeps {
  governanceEngine?: GovernanceEngine | null;
  policyEngine?: PolicyEngine | null;
  vaultStore?: VaultStore | null;
  usageTracker?: UsageTracker | null;
}

export function governanceRouter(deps: GovernanceDeps): Hono {
  const app = new Hono();
  const { governanceEngine, policyEngine, vaultStore, usageTracker } = deps;

  app.get("/governance/rules", (c) => {
    if (!governanceEngine) return c.json({ rules: [], directives: "" });
    return c.json({ rules: governanceEngine.getRules(), directives: governanceEngine.getDirectivesBlock() });
  });

  app.post("/governance/evaluate", async (c) => {
    if (!governanceEngine) return c.json({ allowed: true });
    const body = await c.req.json();
    const result = governanceEngine.evaluate(body.tool ?? "", body.args ?? {});
    if (vaultStore) {
      vaultStore.logGovernance({
        sessionId: body.sessionID ?? body.sessionId ?? null,
        tool: body.tool ?? null,
        ruleId: result.ruleId ?? null,
        action: result.allowed ? "allowed" : "blocked",
        reason: result.reason ?? null,
      });
    }
    return c.json(result);
  });

  app.post("/audit/log", async (c) => {
    if (!vaultStore) return c.json({ ok: true });
    const body = await c.req.json();
    vaultStore.logAudit({
      sessionId: body.sessionID ?? body.sessionId ?? null,
      tool: body.tool ?? "unknown",
      args: typeof body.args === "string" ? body.args : JSON.stringify(body.args ?? null),
      result: typeof body.result === "string" ? body.result : JSON.stringify(body.result ?? null),
      durationMs: body.durationMs ?? null,
    });
    return c.json({ ok: true });
  });

  app.post("/usage/record", async (c) => {
    if (!usageTracker) return c.json({ error: "Usage tracking not configured" }, 503);
    const body = await c.req.json();
    const id = usageTracker.record({
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

  app.post("/usage/summary", async (c) => {
    if (!usageTracker) return c.json({ error: "Usage tracking not configured" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const summary = usageTracker.summarize({
      senderId: body.senderId,
      since: body.since,
      until: body.until,
    });
    return c.json(summary);
  });

  app.get("/policy/status", (c) => {
    if (!policyEngine) return c.json({ enabled: false });
    return c.json({ enabled: policyEngine.enabled, config: policyEngine.getConfig() });
  });

  app.post("/policy/check-tool", async (c) => {
    if (!policyEngine?.enabled) return c.json({ allowed: true });
    const body = await c.req.json();
    const result = policyEngine.isToolAllowed(body.tool ?? "");
    return c.json(result);
  });

  app.post("/policy/check-permission", async (c) => {
    if (!policyEngine?.enabled) return c.json({ denied: false });
    const body = await c.req.json();
    return c.json({ denied: policyEngine.isPermissionDenied(body.permission ?? "") });
  });

  app.get("/policy/audit", (c) => {
    if (!policyEngine?.enabled) return c.json({ enabled: false, results: [] });
    const results = policyEngine.auditAll();
    const compliant = results.every((r) => r.compliant);
    return c.json({ enabled: true, compliant, results });
  });

  // ── Execution Traces ──

  app.get("/traces/:turn_id", (c) => {
    if (!vaultStore) return c.json({ error: "vault not configured" }, 503);
    const turnId = c.req.param("turn_id");
    const rows = vaultStore.listAuditLog({ limit: 200 });
    const steps = rows
      .filter((r: any) => r.turn_id === turnId)
      .sort((a: any, b: any) => (a.step_index ?? 0) - (b.step_index ?? 0));
    return c.json({ turn_id: turnId, steps });
  });

  app.get("/traces", (c) => {
    if (!vaultStore) return c.json({ error: "vault not configured" }, 503);
    const session = c.req.query("session");
    const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
    const rows = vaultStore.listAuditLog({ limit: 500 });
    const filtered = session ? rows.filter((r: any) => r.session_id === session) : rows;
    // Group by turn_id
    const turns = new Map<string, any[]>();
    for (const row of filtered.slice(0, limit * 10)) {
      const key = (row as any).turn_id ?? `no-turn-${row.id}`;
      if (!turns.has(key)) turns.set(key, []);
      turns.get(key)!.push(row);
    }
    const result = Array.from(turns.entries())
      .slice(0, limit)
      .map(([turn_id, steps]) => ({ turn_id, steps: steps.length, first: steps[steps.length - 1]?.timestamp }));
    return c.json({ turns: result });
  });


  return app;
}
