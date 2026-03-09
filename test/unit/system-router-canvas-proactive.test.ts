/**
 * Unit tests for src/bridge/routers/system.ts
 * Covers: canvas, proactive, onboarding, and combined endpoint paths.
 * Issue #107 — coverage fix
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

function makeHeartbeatRef() {
  return { engine: null };
}

async function req(app: Hono, method: "GET" | "POST", path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return app.request(path, init);
}

// ─── POST /canvas/update ──────────────────────────────────────────────────────

describe("POST /canvas/update — no canvasServer", () => {
  it("returns 503 when canvasServer is null", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), canvasServer: null });
    const res = await req(app, "POST", "/canvas/update", { component: { id: "test" } });
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.error).toContain("Canvas");
  });
});

describe("POST /canvas/update — with canvasServer", () => {
  let canvasServer: any;
  let mockSession: any;

  beforeEach(() => {
    mockSession = {
      clearComponents: vi.fn(),
      removeComponent: vi.fn(),
    };
    canvasServer = {
      updateComponent: vi.fn(),
      getSession: vi.fn().mockReturnValue(mockSession),
    };
  });

  it("updates component when body.component is present", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), canvasServer });
    const res = await req(app, "POST", "/canvas/update", { component: { id: "panel-1" }, sessionId: "sess-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(canvasServer.updateComponent).toHaveBeenCalledWith("sess-1", { id: "panel-1" });
  });

  it("uses 'default' sessionId when not provided", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), canvasServer });
    await req(app, "POST", "/canvas/update", { component: { id: "panel-1" } });
    expect(canvasServer.updateComponent).toHaveBeenCalledWith("default", { id: "panel-1" });
  });

  it("clears components when body.clear is truthy", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), canvasServer });
    const res = await req(app, "POST", "/canvas/update", { clear: true });
    expect(res.status).toBe(200);
    expect(canvasServer.getSession).toHaveBeenCalled();
    expect(mockSession.clearComponents).toHaveBeenCalled();
  });

  it("removes component when body.remove is provided", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), canvasServer });
    const res = await req(app, "POST", "/canvas/update", { remove: "panel-2" });
    expect(res.status).toBe(200);
    expect(mockSession.removeComponent).toHaveBeenCalledWith("panel-2");
  });
});

// ─── POST /proactive/intent ───────────────────────────────────────────────────

describe("POST /proactive/intent — no intentStore", () => {
  it("returns 503 when intentStore is null", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef() });
    const res = await req(app, "POST", "/proactive/intent", { what: "check back" });
    expect(res.status).toBe(503);
  });
});

describe("POST /proactive/intent — with intentStore", () => {
  let intentStore: any;

  beforeEach(() => {
    intentStore = {
      addIntent: vi.fn().mockReturnValue("intent-id-1"),
      cancelIntent: vi.fn().mockReturnValue(true),
      listAllPending: vi.fn().mockReturnValue({ intents: [], triggers: [] }),
      getQuotaStatus: vi.fn().mockReturnValue({ allowed: true, sentToday: 0, limit: 3, engagementRate: 0 }),
      listDormantUsers: vi.fn().mockReturnValue([]),
      markIntentExecuted: vi.fn(),
      markEngaged: vi.fn(),
    };
  });

  it("creates intent from body fields and returns id", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    const res = await req(app, "POST", "/proactive/intent", {
      channelId: "telegram",
      chatId: "chat-1",
      senderId: "user-1",
      what: "follow up on deployment",
      confidence: 0.9,
      delayMs: 3600000,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe("intent-id-1");
    expect(intentStore.addIntent).toHaveBeenCalledWith(expect.objectContaining({
      channelId: "telegram",
      senderId: "user-1",
      what: "follow up on deployment",
    }));
  });

  it("resolves senderId from sessionMap when not in body", async () => {
    const sessionMap = {
      findBySessionId: vi.fn().mockResolvedValue({
        channelId: "discord",
        chatId: "chat-2",
        senderId: "user-2",
      }),
    };
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore, sessionMap: sessionMap as any });
    await req(app, "POST", "/proactive/intent", { sessionId: "sess-abc", what: "check in" });
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("sess-abc");
    expect(intentStore.addIntent).toHaveBeenCalledWith(expect.objectContaining({
      channelId: "discord",
      senderId: "user-2",
    }));
  });

  it("uses sessionID field as well as sessionId", async () => {
    const sessionMap = {
      findBySessionId: vi.fn().mockResolvedValue({ channelId: "slack", chatId: "c1", senderId: "u3" }),
    };
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore, sessionMap: sessionMap as any });
    await req(app, "POST", "/proactive/intent", { sessionID: "sess-xyz", what: "check status" });
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("sess-xyz");
  });

  it("uses default delay of 86400000ms when not provided", async () => {
    const now = Date.now();
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    await req(app, "POST", "/proactive/intent", { what: "check back" });
    const call = intentStore.addIntent.mock.calls[0][0];
    expect(call.executeAt).toBeGreaterThanOrEqual(now + 86_400_000 - 100);
  });
});

// ─── POST /proactive/cancel ───────────────────────────────────────────────────

describe("POST /proactive/cancel", () => {
  it("returns 503 when intentStore is null", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef() });
    const res = await req(app, "POST", "/proactive/cancel", { id: "i-1" });
    expect(res.status).toBe(503);
  });

  it("cancels intent and returns ok", async () => {
    const intentStore = { cancelIntent: vi.fn().mockReturnValue(true) } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    const res = await req(app, "POST", "/proactive/cancel", { id: "i-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(intentStore.cancelIntent).toHaveBeenCalledWith("i-1");
  });

  it("returns ok:false when intent not found", async () => {
    const intentStore = { cancelIntent: vi.fn().mockReturnValue(false) } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    const res = await req(app, "POST", "/proactive/cancel", { id: "missing" });
    const body = await res.json() as any;
    expect(body.ok).toBe(false);
  });

  it("handles missing id gracefully", async () => {
    const intentStore = { cancelIntent: vi.fn().mockReturnValue(false) } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    await req(app, "POST", "/proactive/cancel", {});
    expect(intentStore.cancelIntent).toHaveBeenCalledWith("");
  });
});

// ─── GET /proactive/pending ───────────────────────────────────────────────────

describe("GET /proactive/pending", () => {
  it("returns empty lists when intentStore is null", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef() });
    const res = await req(app, "GET", "/proactive/pending");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.intents).toEqual([]);
    expect(body.triggers).toEqual([]);
  });

  it("returns pending intents from store", async () => {
    const intentStore = {
      listAllPending: vi.fn().mockReturnValue({ intents: [{ id: "i1" }], triggers: [] }),
    } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    const res = await req(app, "GET", "/proactive/pending");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.intents).toHaveLength(1);
    expect(intentStore.listAllPending).toHaveBeenCalledWith(20);
  });

  it("respects limit query parameter", async () => {
    const intentStore = {
      listAllPending: vi.fn().mockReturnValue({ intents: [], triggers: [] }),
    } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    await req(app, "GET", "/proactive/pending?limit=5");
    expect(intentStore.listAllPending).toHaveBeenCalledWith(5);
  });
});

// ─── GET /proactive/quota ─────────────────────────────────────────────────────

describe("GET /proactive/quota", () => {
  it("returns allowed:true with defaults when intentStore is null", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef() });
    const res = await req(app, "GET", "/proactive/quota");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.allowed).toBe(true);
    expect(body.sentToday).toBe(0);
  });

  it("returns quota status from store", async () => {
    const intentStore = {
      getQuotaStatus: vi.fn().mockReturnValue({ allowed: false, sentToday: 3, limit: 3, engagementRate: 0.5 }),
    } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    const res = await req(app, "GET", "/proactive/quota?senderId=u1&channelId=tg");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.allowed).toBe(false);
    expect(body.sentToday).toBe(3);
    expect(intentStore.getQuotaStatus).toHaveBeenCalledWith("u1", "tg", 3);
  });
});

// ─── POST /proactive/scan ─────────────────────────────────────────────────────

describe("POST /proactive/scan", () => {
  it("returns 503 when intentStore is null", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef() });
    const res = await req(app, "POST", "/proactive/scan", {});
    expect(res.status).toBe(503);
  });

  it("returns dormant users from store", async () => {
    const intentStore = {
      listDormantUsers: vi.fn().mockReturnValue([{ senderId: "u1" }]),
    } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    const res = await req(app, "POST", "/proactive/scan", { thresholdMs: 604800000 });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.users).toHaveLength(1);
    expect(intentStore.listDormantUsers).toHaveBeenCalledWith(604800000, 10);
  });

  it("uses default threshold when not in body", async () => {
    const intentStore = {
      listDormantUsers: vi.fn().mockReturnValue([]),
    } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    await req(app, "POST", "/proactive/scan");
    expect(intentStore.listDormantUsers).toHaveBeenCalledWith(604_800_000, 10);
  });
});

// ─── POST /proactive/execute ──────────────────────────────────────────────────

describe("POST /proactive/execute", () => {
  it("returns 503 when intentStore is null", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef() });
    const res = await req(app, "POST", "/proactive/execute", { id: "i-1" });
    expect(res.status).toBe(503);
  });

  it("marks intent executed and returns ok", async () => {
    const intentStore = { markIntentExecuted: vi.fn() } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    const res = await req(app, "POST", "/proactive/execute", { id: "i-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(intentStore.markIntentExecuted).toHaveBeenCalledWith("i-1", "manual_trigger");
  });
});

// ─── POST /proactive/engage ───────────────────────────────────────────────────

describe("POST /proactive/engage", () => {
  it("returns 503 when intentStore is null", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef() });
    const res = await req(app, "POST", "/proactive/engage", { senderId: "u1" });
    expect(res.status).toBe(503);
  });

  it("marks engagement and returns ok", async () => {
    const intentStore = { markEngaged: vi.fn() } as any;
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), intentStore });
    const res = await req(app, "POST", "/proactive/engage", { senderId: "u1", channelId: "tg" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(intentStore.markEngaged).toHaveBeenCalledWith("u1", "tg");
  });
});

// ─── POST /onboarding/enrich ──────────────────────────────────────────────────

describe("POST /onboarding/enrich — no signalStore", () => {
  it("returns 503 when signalStore is null", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef() });
    const res = await req(app, "POST", "/onboarding/enrich", { field: "name", value: "Alice" });
    expect(res.status).toBe(503);
  });
});

describe("POST /onboarding/enrich — with signalStore", () => {
  let signalStore: any;
  let vaultStore: any;
  let sessionMap: any;

  beforeEach(() => {
    signalStore = { addSignal: vi.fn() };
    vaultStore = { upsertProfile: vi.fn() };
    sessionMap = {
      findBySessionId: vi.fn().mockResolvedValue({ senderId: "user-1", channelId: "telegram" }),
    };
  });

  it("returns 400 when field is missing", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), signalStore });
    const res = await req(app, "POST", "/onboarding/enrich", { value: "Alice" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when value is missing", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), signalStore });
    const res = await req(app, "POST", "/onboarding/enrich", { field: "name" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when sender cannot be resolved from session", async () => {
    const noSessionMap = { findBySessionId: vi.fn().mockResolvedValue(null) };
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), signalStore, sessionMap: noSessionMap as any });
    const res = await req(app, "POST", "/onboarding/enrich", {
      field: "name", value: "Alice", sessionID: "unknown-sess",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("sender");
  });

  it("enriches profile with name field and calls vaultStore.upsertProfile", async () => {
    const app = buildApp({
      heartbeatRef: makeHeartbeatRef(), signalStore, vaultStore, sessionMap: sessionMap as any,
    });
    const res = await req(app, "POST", "/onboarding/enrich", {
      field: "name", value: "Alice", sessionID: "sess-abc", confidence: 0.95,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(signalStore.addSignal).toHaveBeenCalledWith(expect.objectContaining({
      senderId: "user-1",
      channelId: "telegram",
      signalType: "name",
      value: "Alice",
      confidence: 0.95,
    }));
    expect(vaultStore.upsertProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: "Alice",
    }));
  });

  it("enriches language field and calls vaultStore.upsertProfile", async () => {
    const app = buildApp({
      heartbeatRef: makeHeartbeatRef(), signalStore, vaultStore, sessionMap: sessionMap as any,
    });
    await req(app, "POST", "/onboarding/enrich", {
      field: "language", value: "fr", sessionID: "sess-abc",
    });
    expect(vaultStore.upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ language: "fr" }));
  });

  it("enriches timezone field and calls vaultStore.upsertProfile", async () => {
    const app = buildApp({
      heartbeatRef: makeHeartbeatRef(), signalStore, vaultStore, sessionMap: sessionMap as any,
    });
    await req(app, "POST", "/onboarding/enrich", {
      field: "timezone", value: "America/New_York", sessionID: "sess-abc",
    });
    expect(vaultStore.upsertProfile).toHaveBeenCalledWith(expect.objectContaining({
      timezone: "America/New_York",
    }));
  });

  it("does not call upsertProfile for non-profile fields", async () => {
    const app = buildApp({
      heartbeatRef: makeHeartbeatRef(), signalStore, vaultStore, sessionMap: sessionMap as any,
    });
    await req(app, "POST", "/onboarding/enrich", {
      field: "interests", value: "music", sessionID: "sess-abc",
    });
    expect(signalStore.addSignal).toHaveBeenCalled();
    expect(vaultStore.upsertProfile).not.toHaveBeenCalled();
  });

  it("uses default confidence of 0.9 when not provided", async () => {
    const app = buildApp({
      heartbeatRef: makeHeartbeatRef(), signalStore, vaultStore, sessionMap: sessionMap as any,
    });
    await req(app, "POST", "/onboarding/enrich", {
      field: "name", value: "Bob", sessionID: "sess-abc",
    });
    expect(signalStore.addSignal).toHaveBeenCalledWith(expect.objectContaining({ confidence: 0.9 }));
  });

  it("returns 400 when signalStore present but no sessionMap and sessionID given", async () => {
    const app = buildApp({ heartbeatRef: makeHeartbeatRef(), signalStore });
    const res = await req(app, "POST", "/onboarding/enrich", {
      field: "name", value: "Alice", sessionID: "sess-abc",
    });
    expect(res.status).toBe(400);
  });
});
