/**
 * Extended unit tests for system router — canvas, proactive, and onboarding endpoints.
 * Covers uncovered lines from issue #107: system.ts lines 101-104, 109-131.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { systemRouter } from "../../src/bridge/routers/system.js";
import type { SystemDeps } from "../../src/bridge/routers/system.js";

function mockLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

function makeIntentStore() {
  return {
    addIntent: vi.fn().mockReturnValue("intent-1"),
    cancelIntent: vi.fn().mockReturnValue(true),
    listAllPending: vi.fn().mockReturnValue({ intents: [], triggers: [] }),
    getQuotaStatus: vi.fn().mockReturnValue({ allowed: true, sentToday: 0, limit: 3, engagementRate: 0 }),
    listDormantUsers: vi.fn().mockReturnValue([]),
    markIntentExecuted: vi.fn(),
    markEngaged: vi.fn(),
  };
}

function makeSignalStore() {
  return { addSignal: vi.fn() };
}

function makeVaultStore() {
  return { upsertProfile: vi.fn() };
}

function makeSessionMap() {
  return {
    findBySessionId: vi.fn().mockResolvedValue(null),
  };
}

function makeCanvasServer() {
  return {
    updateComponent: vi.fn(),
    getSession: vi.fn().mockReturnValue({ clearComponents: vi.fn(), removeComponent: vi.fn() }),
  };
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

// ─── Canvas ──────────────────────────────────────────────────────────────────

describe("POST /canvas/update — no canvas server", () => {
  it("returns 503 when canvasServer is null", async () => {
    const app = buildApp({ heartbeatRef: { engine: null }, canvasServer: null });
    const res = await req(app, "POST", "/canvas/update", { component: { type: "text", text: "hi" } });
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.error).toBe("Canvas not configured");
  });
});

describe("POST /canvas/update — with canvas server", () => {
  it("calls updateComponent when component is provided", async () => {
    const canvasServer = makeCanvasServer();
    const app = buildApp({ heartbeatRef: { engine: null }, canvasServer: canvasServer as any });
    const res = await req(app, "POST", "/canvas/update", { sessionId: "s1", component: { type: "text" } });
    expect(res.status).toBe(200);
    expect(canvasServer.updateComponent).toHaveBeenCalledWith("s1", { type: "text" });
  });

  it("uses 'default' sessionId when not provided", async () => {
    const canvasServer = makeCanvasServer();
    const app = buildApp({ heartbeatRef: { engine: null }, canvasServer: canvasServer as any });
    await req(app, "POST", "/canvas/update", { component: { type: "text" } });
    expect(canvasServer.updateComponent).toHaveBeenCalledWith("default", { type: "text" });
  });

  it("calls clearComponents when clear is set", async () => {
    const session = { clearComponents: vi.fn(), removeComponent: vi.fn() };
    const canvasServer = { updateComponent: vi.fn(), getSession: vi.fn().mockReturnValue(session) };
    const app = buildApp({ heartbeatRef: { engine: null }, canvasServer: canvasServer as any });
    const res = await req(app, "POST", "/canvas/update", { clear: true });
    expect(res.status).toBe(200);
    expect(session.clearComponents).toHaveBeenCalled();
  });

  it("calls removeComponent when remove is set", async () => {
    const session = { clearComponents: vi.fn(), removeComponent: vi.fn() };
    const canvasServer = { updateComponent: vi.fn(), getSession: vi.fn().mockReturnValue(session) };
    const app = buildApp({ heartbeatRef: { engine: null }, canvasServer: canvasServer as any });
    const res = await req(app, "POST", "/canvas/update", { remove: "comp-id" });
    expect(res.status).toBe(200);
    expect(session.removeComponent).toHaveBeenCalledWith("comp-id");
  });
});

// ─── Proactive engage ────────────────────────────────────────────────────────

describe("POST /proactive/engage — no intent store", () => {
  it("returns 503 when intentStore is null", async () => {
    const app = buildApp({ heartbeatRef: { engine: null }, intentStore: null });
    const res = await req(app, "POST", "/proactive/engage", { senderId: "u1", channelId: "tg" });
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.error).toBe("Proactive not enabled");
  });
});

describe("POST /proactive/engage — with intent store", () => {
  it("calls markEngaged with senderId and channelId", async () => {
    const intentStore = makeIntentStore();
    const app = buildApp({ heartbeatRef: { engine: null }, intentStore: intentStore as any });
    const res = await req(app, "POST", "/proactive/engage", { senderId: "user-1", channelId: "telegram" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(intentStore.markEngaged).toHaveBeenCalledWith("user-1", "telegram");
  });

  it("falls back to empty strings for missing senderId/channelId", async () => {
    const intentStore = makeIntentStore();
    const app = buildApp({ heartbeatRef: { engine: null }, intentStore: intentStore as any });
    await req(app, "POST", "/proactive/engage", {});
    expect(intentStore.markEngaged).toHaveBeenCalledWith("", "");
  });
});

// ─── Onboarding enrich ────────────────────────────────────────────────────────

describe("POST /onboarding/enrich — no signal store", () => {
  it("returns 503 when signalStore is null", async () => {
    const app = buildApp({ heartbeatRef: { engine: null }, signalStore: null });
    const res = await req(app, "POST", "/onboarding/enrich", { field: "name", value: "Alice" });
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.error).toBe("Onboarding not configured");
  });
});

describe("POST /onboarding/enrich — with signal store", () => {
  it("returns 400 when field is missing", async () => {
    const signalStore = makeSignalStore();
    const app = buildApp({ heartbeatRef: { engine: null }, signalStore: signalStore as any });
    const res = await req(app, "POST", "/onboarding/enrich", { value: "Alice" });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe("field and value required");
  });

  it("returns 400 when value is missing", async () => {
    const signalStore = makeSignalStore();
    const app = buildApp({ heartbeatRef: { engine: null }, signalStore: signalStore as any });
    const res = await req(app, "POST", "/onboarding/enrich", { field: "name" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when session cannot be resolved (no sessionMap)", async () => {
    const signalStore = makeSignalStore();
    const app = buildApp({ heartbeatRef: { engine: null }, signalStore: signalStore as any, sessionMap: null });
    const res = await req(app, "POST", "/onboarding/enrich", { field: "name", value: "Alice" });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe("Could not resolve sender from session");
  });

  it("returns 400 when sessionMap.findBySessionId returns null", async () => {
    const signalStore = makeSignalStore();
    const sessionMap = makeSessionMap();
    const app = buildApp({ heartbeatRef: { engine: null }, signalStore: signalStore as any, sessionMap: sessionMap as any });
    const res = await req(app, "POST", "/onboarding/enrich", { field: "name", value: "Alice", sessionID: "s1" });
    expect(res.status).toBe(400);
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("s1");
  });

  it("adds signal and returns ok when session resolves correctly", async () => {
    const signalStore = makeSignalStore();
    const sessionMap = { findBySessionId: vi.fn().mockResolvedValue({ senderId: "u1", channelId: "tg" }) };
    const app = buildApp({ heartbeatRef: { engine: null }, signalStore: signalStore as any, sessionMap: sessionMap as any });
    const res = await req(app, "POST", "/onboarding/enrich", { field: "name", value: "Alice", sessionID: "s1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(signalStore.addSignal).toHaveBeenCalledWith(expect.objectContaining({
      senderId: "u1", channelId: "tg", signalType: "name", value: "Alice",
    }));
  });

  it("calls vaultStore.upsertProfile for profile fields (name/language/timezone)", async () => {
    const signalStore = makeSignalStore();
    const vaultStore = makeVaultStore();
    const sessionMap = { findBySessionId: vi.fn().mockResolvedValue({ senderId: "u1", channelId: "tg" }) };
    const app = buildApp({
      heartbeatRef: { engine: null },
      signalStore: signalStore as any,
      vaultStore: vaultStore as any,
      sessionMap: sessionMap as any,
    });
    const res = await req(app, "POST", "/onboarding/enrich", { field: "name", value: "Alice", sessionID: "s1" });
    expect(res.status).toBe(200);
    expect(vaultStore.upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "Alice" }));
  });

  it("does NOT call vaultStore.upsertProfile for non-profile fields", async () => {
    const signalStore = makeSignalStore();
    const vaultStore = makeVaultStore();
    const sessionMap = { findBySessionId: vi.fn().mockResolvedValue({ senderId: "u1", channelId: "tg" }) };
    const app = buildApp({
      heartbeatRef: { engine: null },
      signalStore: signalStore as any,
      vaultStore: vaultStore as any,
      sessionMap: sessionMap as any,
    });
    await req(app, "POST", "/onboarding/enrich", { field: "custom_field", value: "val", sessionID: "s1" });
    expect(vaultStore.upsertProfile).not.toHaveBeenCalled();
  });

  it("uses custom confidence when provided", async () => {
    const signalStore = makeSignalStore();
    const sessionMap = { findBySessionId: vi.fn().mockResolvedValue({ senderId: "u1", channelId: "tg" }) };
    const app = buildApp({ heartbeatRef: { engine: null }, signalStore: signalStore as any, sessionMap: sessionMap as any });
    await req(app, "POST", "/onboarding/enrich", { field: "name", value: "Bob", confidence: 0.5, sessionID: "s1" });
    expect(signalStore.addSignal).toHaveBeenCalledWith(expect.objectContaining({ confidence: 0.5 }));
  });

  it("uses default confidence 0.9 when not provided", async () => {
    const signalStore = makeSignalStore();
    const sessionMap = { findBySessionId: vi.fn().mockResolvedValue({ senderId: "u1", channelId: "tg" }) };
    const app = buildApp({ heartbeatRef: { engine: null }, signalStore: signalStore as any, sessionMap: sessionMap as any });
    await req(app, "POST", "/onboarding/enrich", { field: "name", value: "Bob", sessionID: "s1" });
    expect(signalStore.addSignal).toHaveBeenCalledWith(expect.objectContaining({ confidence: 0.9 }));
  });
});

// ─── Proactive other endpoints (extend coverage) ─────────────────────────────

describe("POST /proactive/intent — with sessionMap resolution", () => {
  it("resolves channelId and senderId from sessionMap when missing", async () => {
    const intentStore = makeIntentStore();
    const sessionMap = { findBySessionId: vi.fn().mockResolvedValue({ channelId: "tg", chatId: "chat1", senderId: "user1" }) };
    const app = buildApp({ heartbeatRef: { engine: null }, intentStore: intentStore as any, sessionMap: sessionMap as any });
    const res = await req(app, "POST", "/proactive/intent", { sessionID: "s1", what: "remind me" });
    expect(res.status).toBe(200);
    expect(intentStore.addIntent).toHaveBeenCalledWith(expect.objectContaining({ channelId: "tg", senderId: "user1" }));
  });
});

describe("POST /proactive/execute — with intentStore", () => {
  it("calls markIntentExecuted and returns ok", async () => {
    const intentStore = makeIntentStore();
    const app = buildApp({ heartbeatRef: { engine: null }, intentStore: intentStore as any });
    const res = await req(app, "POST", "/proactive/execute", { id: "intent-42" });
    expect(res.status).toBe(200);
    expect(intentStore.markIntentExecuted).toHaveBeenCalledWith("intent-42", "manual_trigger");
  });
});
