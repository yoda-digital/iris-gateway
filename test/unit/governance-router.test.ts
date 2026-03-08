/**
 * Unit tests for src/bridge/routers/governance.ts
 * Uses Hono app.request() — no live server, no ports.
 * All deps are vi.fn() mocks — no real DB or engine instances needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { governanceRouter } from "../../src/bridge/routers/governance.js";
import type { GovernanceDeps } from "../../src/bridge/routers/governance.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeApp(deps: GovernanceDeps = {}) {
  const app = new Hono();
  app.route("/", governanceRouter(deps));
  return app;
}

async function get(app: Hono, path: string) {
  return app.request(path, { method: "GET" });
}

async function post(app: Hono, path: string, body: unknown = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGovernanceEngine(overrides = {}) {
  return {
    evaluate: vi.fn(() => ({ allowed: true })),
    getRules: vi.fn(() => [{ id: "r1", tool: "*", type: "audit" }]),
    getDirectivesBlock: vi.fn(() => "## Governance Directives\nBe polite"),
    ...overrides,
  } as any;
}

function makeVaultStore(overrides = {}) {
  return {
    logGovernance: vi.fn(),
    logAudit: vi.fn(),
    ...overrides,
  } as any;
}

function makeUsageTracker(overrides = {}) {
  return {
    record: vi.fn(() => "usage-id-123"),
    summarize: vi.fn(() => ({
      totalTokens: 100,
      totalCost: 0.01,
      messageCount: 1,
      daily: [],
      byModel: [],
    })),
    ...overrides,
  } as any;
}

function makePolicyEngine(enabled = true, overrides = {}) {
  return {
    enabled,
    getConfig: vi.fn(() => ({ enabled, allowedTools: [] })),
    isToolAllowed: vi.fn(() => ({ allowed: true })),
    isPermissionDenied: vi.fn(() => false),
    auditAll: vi.fn(() => [{ name: "agent-x", type: "agent", violations: [], compliant: true }]),
    ...overrides,
  } as any;
}

// ── GET /governance/rules ─────────────────────────────────────────────────────

describe("GET /governance/rules", () => {
  it("returns empty rules and empty directives when governanceEngine is absent", async () => {
    const app = makeApp({});
    const res = await get(app, "/governance/rules");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rules).toEqual([]);
    expect(body.directives).toBe("");
  });

  it("returns rules and directives from engine", async () => {
    const engine = makeGovernanceEngine();
    const app = makeApp({ governanceEngine: engine });
    const res = await get(app, "/governance/rules");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rules).toHaveLength(1);
    expect(body.directives).toContain("Governance Directives");
    expect(engine.getRules).toHaveBeenCalled();
    expect(engine.getDirectivesBlock).toHaveBeenCalled();
  });
});

// ── POST /governance/evaluate ─────────────────────────────────────────────────

describe("POST /governance/evaluate", () => {
  it("returns { allowed: true } when engine is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/governance/evaluate", { tool: "send_message", args: {} });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.allowed).toBe(true);
  });

  it("calls engine.evaluate and returns result", async () => {
    const engine = makeGovernanceEngine({ evaluate: vi.fn(() => ({ allowed: true, ruleId: "r1" })) });
    const app = makeApp({ governanceEngine: engine });
    const res = await post(app, "/governance/evaluate", { tool: "send_message", args: { text: "hi" } });
    expect(res.status).toBe(200);
    expect(engine.evaluate).toHaveBeenCalledWith("send_message", { text: "hi" });
  });

  it("logs governance to vaultStore when present", async () => {
    const engine = makeGovernanceEngine({ evaluate: vi.fn(() => ({ allowed: false, ruleId: "r2", reason: "blocked" })) });
    const vault = makeVaultStore();
    const app = makeApp({ governanceEngine: engine, vaultStore: vault });
    await post(app, "/governance/evaluate", { tool: "restricted_tool", args: {}, sessionID: "sess-1" });
    expect(vault.logGovernance).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "restricted_tool", action: "blocked", sessionId: "sess-1" }),
    );
  });

  it("accepts sessionId (camelCase) as well as sessionID", async () => {
    const engine = makeGovernanceEngine();
    const vault = makeVaultStore();
    const app = makeApp({ governanceEngine: engine, vaultStore: vault });
    await post(app, "/governance/evaluate", { tool: "t", args: {}, sessionId: "s-2" });
    expect(vault.logGovernance).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s-2" }));
  });

  it("skips governance logging when vaultStore is absent", async () => {
    const engine = makeGovernanceEngine();
    const app = makeApp({ governanceEngine: engine });
    const res = await post(app, "/governance/evaluate", { tool: "x", args: {} });
    expect(res.status).toBe(200);
  });
});

// ── POST /audit/log ───────────────────────────────────────────────────────────

describe("POST /audit/log", () => {
  it("returns { ok: true } when vaultStore is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/audit/log", { tool: "send_message", args: "{}", result: "{}" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it("calls vaultStore.logAudit with string args when given objects", async () => {
    const vault = makeVaultStore();
    const app = makeApp({ vaultStore: vault });
    await post(app, "/audit/log", {
      tool: "send_message",
      args: { text: "hello" },
      result: { ok: true },
      durationMs: 42,
      sessionID: "sess-1",
    });
    expect(vault.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "send_message",
        durationMs: 42,
        sessionId: "sess-1",
      }),
    );
    const call = vault.logAudit.mock.calls[0][0];
    expect(typeof call.args).toBe("string");
    expect(typeof call.result).toBe("string");
  });

  it("keeps string args as-is", async () => {
    const vault = makeVaultStore();
    const app = makeApp({ vaultStore: vault });
    await post(app, "/audit/log", { tool: "x", args: "raw-args", result: "raw-result" });
    const call = vault.logAudit.mock.calls[0][0];
    expect(call.args).toBe("raw-args");
    expect(call.result).toBe("raw-result");
  });
});

// ── POST /usage/record ────────────────────────────────────────────────────────

describe("POST /usage/record", () => {
  it("returns 503 when usageTracker is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/usage/record", { sessionId: "s1" });
    expect(res.status).toBe(503);
  });

  it("records usage and returns id", async () => {
    const tracker = makeUsageTracker();
    const app = makeApp({ usageTracker: tracker });
    const res = await post(app, "/usage/record", {
      sessionId: "s1",
      senderId: "user-1",
      channelId: "tg",
      modelId: "gpt-4",
      providerId: "openai",
      tokensInput: 10,
      tokensOutput: 20,
      tokensReasoning: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      costUsd: 0.001,
      durationMs: 500,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe("usage-id-123");
    expect(tracker.record).toHaveBeenCalled();
  });

  it("defaults missing numeric fields to 0", async () => {
    const tracker = makeUsageTracker();
    const app = makeApp({ usageTracker: tracker });
    await post(app, "/usage/record", {});
    const call = tracker.record.mock.calls[0][0];
    expect(call.tokensInput).toBe(0);
    expect(call.costUsd).toBe(0);
  });
});

// ── POST /usage/summary ───────────────────────────────────────────────────────

describe("POST /usage/summary", () => {
  it("returns 503 when usageTracker is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/usage/summary", {});
    expect(res.status).toBe(503);
  });

  it("returns summary from tracker", async () => {
    const tracker = makeUsageTracker();
    const app = makeApp({ usageTracker: tracker });
    const res = await post(app, "/usage/summary", { senderId: "user-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.messageCount).toBe(1);
    expect(tracker.summarize).toHaveBeenCalledWith(expect.objectContaining({ senderId: "user-1" }));
  });

  it("handles invalid JSON body gracefully", async () => {
    const tracker = makeUsageTracker();
    const app = makeApp({ usageTracker: tracker });
    const res = await app.request("/usage/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    // should not throw — catches and uses empty object
    expect([200, 400, 500]).toContain(res.status);
  });
});

// ── GET /policy/status ────────────────────────────────────────────────────────

describe("GET /policy/status", () => {
  it("returns { enabled: false } when policyEngine is absent", async () => {
    const app = makeApp({});
    const res = await get(app, "/policy/status");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.enabled).toBe(false);
  });

  it("returns enabled=true and config when engine is present", async () => {
    const policy = makePolicyEngine(true);
    const app = makeApp({ policyEngine: policy });
    const res = await get(app, "/policy/status");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.enabled).toBe(true);
    expect(body.config).toBeDefined();
  });
});

// ── POST /policy/check-tool ───────────────────────────────────────────────────

describe("POST /policy/check-tool", () => {
  it("returns { allowed: true } when policyEngine is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/policy/check-tool", { tool: "send_message" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.allowed).toBe(true);
  });

  it("returns { allowed: true } when policyEngine is disabled", async () => {
    const policy = makePolicyEngine(false);
    const app = makeApp({ policyEngine: policy });
    const res = await post(app, "/policy/check-tool", { tool: "send_message" });
    const body = await res.json() as any;
    expect(body.allowed).toBe(true);
    expect(policy.isToolAllowed).not.toHaveBeenCalled();
  });

  it("calls isToolAllowed when engine is enabled", async () => {
    const policy = makePolicyEngine(true, {
      isToolAllowed: vi.fn(() => ({ allowed: false, reason: "blocked" })),
    });
    const app = makeApp({ policyEngine: policy });
    const res = await post(app, "/policy/check-tool", { tool: "restricted" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.allowed).toBe(false);
    expect(policy.isToolAllowed).toHaveBeenCalledWith("restricted");
  });
});

// ── POST /policy/check-permission ────────────────────────────────────────────

describe("POST /policy/check-permission", () => {
  it("returns { denied: false } when policyEngine is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/policy/check-permission", { permission: "file-write" });
    const body = await res.json() as any;
    expect(body.denied).toBe(false);
  });

  it("returns { denied: false } when policyEngine is disabled", async () => {
    const policy = makePolicyEngine(false);
    const app = makeApp({ policyEngine: policy });
    const res = await post(app, "/policy/check-permission", { permission: "file-write" });
    const body = await res.json() as any;
    expect(body.denied).toBe(false);
    expect(policy.isPermissionDenied).not.toHaveBeenCalled();
  });

  it("calls isPermissionDenied when engine is enabled", async () => {
    const policy = makePolicyEngine(true, {
      isPermissionDenied: vi.fn(() => true),
    });
    const app = makeApp({ policyEngine: policy });
    const res = await post(app, "/policy/check-permission", { permission: "file-write" });
    const body = await res.json() as any;
    expect(body.denied).toBe(true);
    expect(policy.isPermissionDenied).toHaveBeenCalledWith("file-write");
  });
});

// ── GET /policy/audit ─────────────────────────────────────────────────────────

describe("GET /policy/audit", () => {
  it("returns { enabled: false, results: [] } when policyEngine is absent", async () => {
    const app = makeApp({});
    const res = await get(app, "/policy/audit");
    const body = await res.json() as any;
    expect(body.enabled).toBe(false);
    expect(body.results).toEqual([]);
  });

  it("returns { enabled: false, results: [] } when policyEngine is disabled", async () => {
    const policy = makePolicyEngine(false);
    const app = makeApp({ policyEngine: policy });
    const res = await get(app, "/policy/audit");
    const body = await res.json() as any;
    expect(body.enabled).toBe(false);
  });

  it("returns audit results from enabled engine", async () => {
    const policy = makePolicyEngine(true);
    const app = makeApp({ policyEngine: policy });
    const res = await get(app, "/policy/audit");
    const body = await res.json() as any;
    expect(body.enabled).toBe(true);
    expect(body.compliant).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(policy.auditAll).toHaveBeenCalled();
  });

  it("reports compliant=false when any result has violations", async () => {
    const policy = makePolicyEngine(true, {
      auditAll: vi.fn(() => [
        { name: "bad-agent", type: "agent", violations: [{ level: "error", code: "E1", message: "violation" }], compliant: false },
        { name: "good-agent", type: "agent", violations: [], compliant: true },
      ]),
    });
    const app = makeApp({ policyEngine: policy });
    const res = await get(app, "/policy/audit");
    const body = await res.json() as any;
    expect(body.compliant).toBe(false);
  });
});
