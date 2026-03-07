/**
 * Unit tests for system router heartbeat endpoints.
 * Covers /heartbeat/trigger and /heartbeat/status — success paths and edge cases.
 * Issue #66
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { systemRouter } from "../../src/bridge/routers/system.js";
import type { SystemDeps } from "../../src/bridge/routers/system.js";

function mockLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

function buildApp(deps: Partial<SystemDeps> & { heartbeatRef: SystemDeps["heartbeatRef"] }) {
  const fullDeps: SystemDeps = {
    logger: mockLogger(),
    canvasServer: null,
    intentStore: null,
    signalStore: null,
    vaultStore: null,
    sessionMap: null,
    ...deps,
  };
  const router = systemRouter(fullDeps);
  const app = new Hono();
  app.route("/", router);
  return app;
}

async function req(app: Hono, method: "GET" | "POST", path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return app.request(path, init);
}

// ─── GET /heartbeat/status ─────────────────────────────────────────────────────

describe("GET /heartbeat/status — no engine", () => {
  it("returns enabled:false and empty components when engine is null", async () => {
    const app = buildApp({ heartbeatRef: { engine: null } });
    const res = await req(app, "GET", "/heartbeat/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean; components: unknown[] };
    expect(body.enabled).toBe(false);
    expect(body.components).toEqual([]);
  });
});

describe("GET /heartbeat/status — with engine", () => {
  it("returns enabled:true and component list from engine.getStatus()", async () => {
    const fakeComponents = [
      { agentId: "agent1", component: "telegram", status: "ok" },
      { agentId: "agent1", component: "discord", status: "idle" },
    ];
    const engine = {
      getStatus: vi.fn().mockReturnValue(fakeComponents),
      tick: vi.fn().mockResolvedValue(undefined),
    };
    const app = buildApp({ heartbeatRef: { engine } });
    const res = await req(app, "GET", "/heartbeat/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean; components: typeof fakeComponents };
    expect(body.enabled).toBe(true);
    expect(body.components).toEqual(fakeComponents);
    expect(engine.getStatus).toHaveBeenCalledTimes(1);
  });

  it("calls engine.getStatus() each time status is requested", async () => {
    const engine = {
      getStatus: vi.fn().mockReturnValue([]),
      tick: vi.fn(),
    };
    const app = buildApp({ heartbeatRef: { engine } });
    await req(app, "GET", "/heartbeat/status");
    await req(app, "GET", "/heartbeat/status");
    expect(engine.getStatus).toHaveBeenCalledTimes(2);
  });
});

// ─── POST /heartbeat/trigger ───────────────────────────────────────────────────

describe("POST /heartbeat/trigger — no engine", () => {
  it("returns 503 with error message when engine is null", async () => {
    const app = buildApp({ heartbeatRef: { engine: null } });
    const res = await req(app, "POST", "/heartbeat/trigger");
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Heartbeat not enabled");
  });
});

describe("POST /heartbeat/trigger — with engine", () => {
  it("returns ok:true and component list on successful tick", async () => {
    const fakeComponents = [{ agentId: "a", component: "x", status: "ok" }];
    const engine = {
      getStatus: vi.fn().mockReturnValue(fakeComponents),
      tick: vi.fn().mockResolvedValue(undefined),
    };
    const app = buildApp({ heartbeatRef: { engine } });
    const res = await req(app, "POST", "/heartbeat/trigger");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; components: typeof fakeComponents };
    expect(body.ok).toBe(true);
    expect(body.components).toEqual(fakeComponents);
    expect(engine.tick).toHaveBeenCalledTimes(1);
  });

  it("calls engine.tick() once per trigger request", async () => {
    const engine = {
      getStatus: vi.fn().mockReturnValue([]),
      tick: vi.fn().mockResolvedValue(undefined),
    };
    const app = buildApp({ heartbeatRef: { engine } });
    await req(app, "POST", "/heartbeat/trigger");
    await req(app, "POST", "/heartbeat/trigger");
    expect(engine.tick).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when engine.tick() throws", async () => {
    const engine = {
      getStatus: vi.fn().mockReturnValue([]),
      tick: vi.fn().mockRejectedValue(new Error("tick boom")),
    };
    const app = buildApp({ heartbeatRef: { engine } });
    const res = await req(app, "POST", "/heartbeat/trigger");
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Trigger failed");
  });

  it("returns 500 even when tick rejects with non-Error", async () => {
    const engine = {
      getStatus: vi.fn().mockReturnValue([]),
      tick: vi.fn().mockRejectedValue("string error"),
    };
    const app = buildApp({ heartbeatRef: { engine } });
    const res = await req(app, "POST", "/heartbeat/trigger");
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Trigger failed");
  });
});
