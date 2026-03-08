/**
 * Unit tests for src/bridge/routers/intelligence.ts
 * Uses Hono app.request() — no live server, no ports.
 * All 9 deps are nullable; zero-dep tests cover the 503/empty guard paths for free.
 *
 * Key trap documented for future readers:
 * /session/system-context calls sessionMap.findBySessionId TWICE — once for
 * userContext (needs vaultStore+vaultSearch+sessionMap) and once for
 * intelligenceContext (needs promptAssembler+sessionMap). Tests are stratified
 * to cover each path independently and combined.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { intelligenceRouter } from "../../src/bridge/routers/intelligence.js";
import type { IntelligenceDeps } from "../../src/bridge/routers/intelligence.js";
import type { SessionMapEntry } from "../../src/bridge/session-map.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeApp(deps: IntelligenceDeps = {}) {
  const app = new Hono();
  app.route("/", intelligenceRouter(deps));
  return app;
}

async function post(app: Hono, path: string, body: unknown = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSessionEntry(overrides: Partial<SessionMapEntry> = {}): SessionMapEntry {
  return {
    openCodeSessionId: "sess-abc",
    channelId: "tg",
    senderId: "user-1",
    chatId: "chat-1",
    chatType: "dm",
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

function makeSessionMap(entry: SessionMapEntry | null = makeSessionEntry()) {
  return {
    findBySessionId: vi.fn().mockResolvedValue(entry),
  } as any;
}

function makeVaultStore(profile: any = { name: "Alice", timezone: "UTC", language: "en" }) {
  return {
    getProfile: vi.fn(() => profile),
    logGovernance: vi.fn(),
    logAudit: vi.fn(),
  } as any;
}

function makeVaultSearch(memories: any[] = [{ content: "User likes TypeScript" }]) {
  return {
    search: vi.fn(() => memories),
  } as any;
}

function makeGoalLifecycle(overrides = {}) {
  const goal = {
    id: "g-1",
    senderId: "user-1",
    channelId: "tg",
    description: "Test goal",
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    priority: 50,
  };
  return {
    create: vi.fn(() => goal),
    progress: vi.fn(() => goal),
    transition: vi.fn(() => goal),
    listGoals: vi.fn(() => ({ active: [goal], paused: [] })),
    ...overrides,
  } as any;
}

function makeArcLifecycle(overrides = {}) {
  return {
    resolve: vi.fn(),
    abandon: vi.fn(),
    ...overrides,
  } as any;
}

function makeArcDetector(overrides = {}) {
  return {
    processMemory: vi.fn(),
    ...overrides,
  } as any;
}

function makeIntelligenceStore(overrides = {}) {
  return {
    getArcsBySender: vi.fn(() => [{ id: "arc-1", title: "Job search", status: "active" }]),
    ...overrides,
  } as any;
}

function makePromptAssembler(overrides = {}) {
  return {
    render: vi.fn(() => "[Intelligence: active goals: 1]"),
    ...overrides,
  } as any;
}

// ── POST /session/system-context ──────────────────────────────────────────────

describe("POST /session/system-context", () => {
  it("returns defaults when all deps are null", async () => {
    const app = makeApp({});
    const res = await post(app, "/session/system-context", {});
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.directives).toBe("");
    expect(body.channelRules).toBeNull();
    expect(body.userContext).toBeNull();
    expect(body.intelligenceContext).toBeNull();
  });

  it("includes governance directives when governanceEngine is present", async () => {
    const engine = { getDirectivesBlock: vi.fn(() => "## Rules\nBe good") } as any;
    const app = makeApp({ governanceEngine: engine });
    const res = await post(app, "/session/system-context", {});
    const body = await res.json() as any;
    expect(body.directives).toContain("Rules");
  });

  it("builds userContext and channelRules when full vault+sessionMap are present", async () => {
    const sessionMap = makeSessionMap();
    const vaultStore = makeVaultStore();
    const vaultSearch = makeVaultSearch();
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/session/system-context", { sessionID: "sess-abc" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.userContext).toContain("Alice");
    expect(body.channelRules).toContain("tg");
    expect(body.channelRules).toContain("user-1");
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("sess-abc");
  });

  it("omits profile block when profile is null", async () => {
    const sessionMap = makeSessionMap();
    const vaultStore = makeVaultStore(null);
    const vaultSearch = makeVaultSearch([]);
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/session/system-context", { sessionID: "sess-abc" });
    const body = await res.json() as any;
    // No profile and no memories → userContext is null
    expect(body.userContext).toBeNull();
    // But channelRules still resolves
    expect(body.channelRules).toContain("tg");
  });

  it("includes memories in userContext when they exist", async () => {
    const sessionMap = makeSessionMap();
    const vaultStore = makeVaultStore(null); // no profile
    const vaultSearch = makeVaultSearch([{ content: "Likes dark mode" }]);
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/session/system-context", { sessionID: "sess-abc" });
    const body = await res.json() as any;
    expect(body.userContext).toContain("Likes dark mode");
  });

  it("includes intelligenceContext from promptAssembler", async () => {
    const sessionMap = makeSessionMap();
    const promptAssembler = makePromptAssembler();
    const app = makeApp({ sessionMap, promptAssembler });
    const res = await post(app, "/session/system-context", { sessionID: "sess-abc" });
    const body = await res.json() as any;
    expect(body.intelligenceContext).toContain("Intelligence");
    expect(promptAssembler.render).toHaveBeenCalled();
  });

  it("returns null intelligenceContext when sessionMap lookup returns null", async () => {
    const sessionMap = makeSessionMap(null);
    const promptAssembler = makePromptAssembler();
    const app = makeApp({ sessionMap, promptAssembler });
    const res = await post(app, "/session/system-context", { sessionID: "nonexistent" });
    const body = await res.json() as any;
    expect(body.intelligenceContext).toBeNull();
    expect(promptAssembler.render).not.toHaveBeenCalled();
  });

  it("handles missing sessionID gracefully — skips vault lookups", async () => {
    const sessionMap = makeSessionMap();
    const vaultStore = makeVaultStore();
    const vaultSearch = makeVaultSearch();
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/session/system-context", {}); // no sessionID
    const body = await res.json() as any;
    expect(body.userContext).toBeNull();
    expect(sessionMap.findBySessionId).not.toHaveBeenCalled();
  });
});

// ── POST /goals/create ────────────────────────────────────────────────────────

describe("POST /goals/create", () => {
  it("returns 503 when goalLifecycle is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/goals/create", { senderId: "u1", channelId: "tg", description: "Do laundry" });
    expect(res.status).toBe(503);
  });

  it("creates a goal and returns it", async () => {
    const lifecycle = makeGoalLifecycle();
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/create", {
      senderId: "user-1",
      channelId: "tg",
      description: "Build a blog",
      priority: 80,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe("g-1");
    expect(lifecycle.create).toHaveBeenCalledWith(expect.objectContaining({ description: "Build a blog" }));
  });

  it("resolves senderId from sessionMap when not provided in body", async () => {
    const lifecycle = makeGoalLifecycle();
    const sessionMap = makeSessionMap();
    const app = makeApp({ goalLifecycle: lifecycle, sessionMap });
    await post(app, "/goals/create", { sessionID: "sess-abc", description: "Goal via session" });
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("sess-abc");
    const call = lifecycle.create.mock.calls[0][0];
    expect(call.senderId).toBe("user-1");
    expect(call.channelId).toBe("tg");
  });
});

// ── POST /goals/update ────────────────────────────────────────────────────────

describe("POST /goals/update", () => {
  it("returns 503 when goalLifecycle is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/goals/update", { id: "g-1", progressNote: "halfway" });
    expect(res.status).toBe(503);
  });

  it("updates goal and returns it", async () => {
    const lifecycle = makeGoalLifecycle();
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/update", { id: "g-1", progressNote: "50% done", nextAction: "write tests" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe("g-1");
    expect(lifecycle.progress).toHaveBeenCalledWith("g-1", "50% done", "write tests", undefined);
  });

  it("returns 404 when goal not found", async () => {
    const lifecycle = makeGoalLifecycle({ progress: vi.fn(() => null) });
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/update", { id: "nonexistent", progressNote: "n/a" });
    expect(res.status).toBe(404);
  });
});

// ── POST /goals/complete ──────────────────────────────────────────────────────

describe("POST /goals/complete", () => {
  it("returns 503 when goalLifecycle is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/goals/complete", { id: "g-1" });
    expect(res.status).toBe(503);
  });

  it("transitions goal to completed", async () => {
    const lifecycle = makeGoalLifecycle();
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/complete", { id: "g-1" });
    expect(res.status).toBe(200);
    expect(lifecycle.transition).toHaveBeenCalledWith("g-1", "completed");
  });

  it("returns 400 when transition is invalid", async () => {
    const lifecycle = makeGoalLifecycle({ transition: vi.fn(() => null) });
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/complete", { id: "g-1" });
    expect(res.status).toBe(400);
  });
});

// ── POST /goals/pause ─────────────────────────────────────────────────────────

describe("POST /goals/pause", () => {
  it("returns 503 when goalLifecycle is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/goals/pause", { id: "g-1" });
    expect(res.status).toBe(503);
  });

  it("transitions goal to paused", async () => {
    const lifecycle = makeGoalLifecycle();
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/pause", { id: "g-1" });
    expect(res.status).toBe(200);
    expect(lifecycle.transition).toHaveBeenCalledWith("g-1", "paused");
  });

  it("returns 400 when transition is invalid", async () => {
    const lifecycle = makeGoalLifecycle({ transition: vi.fn(() => null) });
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/pause", { id: "g-1" });
    expect(res.status).toBe(400);
  });
});

// ── POST /goals/resume ────────────────────────────────────────────────────────

describe("POST /goals/resume", () => {
  it("returns 503 when goalLifecycle is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/goals/resume", { id: "g-1" });
    expect(res.status).toBe(503);
  });

  it("transitions goal to active", async () => {
    const lifecycle = makeGoalLifecycle();
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/resume", { id: "g-1" });
    expect(res.status).toBe(200);
    expect(lifecycle.transition).toHaveBeenCalledWith("g-1", "active");
  });

  it("returns 400 when transition is invalid", async () => {
    const lifecycle = makeGoalLifecycle({ transition: vi.fn(() => null) });
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/resume", { id: "g-1" });
    expect(res.status).toBe(400);
  });
});

// ── POST /goals/abandon ───────────────────────────────────────────────────────

describe("POST /goals/abandon", () => {
  it("returns 503 when goalLifecycle is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/goals/abandon", { id: "g-1" });
    expect(res.status).toBe(503);
  });

  it("transitions goal to abandoned", async () => {
    const lifecycle = makeGoalLifecycle();
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/abandon", { id: "g-1" });
    expect(res.status).toBe(200);
    expect(lifecycle.transition).toHaveBeenCalledWith("g-1", "abandoned");
  });

  it("returns 400 when transition is invalid", async () => {
    const lifecycle = makeGoalLifecycle({ transition: vi.fn(() => null) });
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/abandon", { id: "g-1" });
    expect(res.status).toBe(400);
  });
});

// ── POST /goals/list ──────────────────────────────────────────────────────────

describe("POST /goals/list", () => {
  it("returns { active: [], paused: [] } when goalLifecycle is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/goals/list", { senderId: "user-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.active).toEqual([]);
    expect(body.paused).toEqual([]);
  });

  it("returns goals for given senderId", async () => {
    const lifecycle = makeGoalLifecycle();
    const app = makeApp({ goalLifecycle: lifecycle });
    const res = await post(app, "/goals/list", { senderId: "user-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.active).toHaveLength(1);
    expect(lifecycle.listGoals).toHaveBeenCalledWith("user-1");
  });

  it("returns empty when senderId cannot be resolved", async () => {
    const lifecycle = makeGoalLifecycle();
    const sessionMap = makeSessionMap(null); // lookup returns null
    const app = makeApp({ goalLifecycle: lifecycle, sessionMap });
    const res = await post(app, "/goals/list", { sessionID: "unknown-sess" });
    const body = await res.json() as any;
    expect(body.active).toEqual([]);
    expect(lifecycle.listGoals).not.toHaveBeenCalled();
  });

  it("resolves senderId from sessionMap when not provided in body", async () => {
    const lifecycle = makeGoalLifecycle();
    const sessionMap = makeSessionMap();
    const app = makeApp({ goalLifecycle: lifecycle, sessionMap });
    await post(app, "/goals/list", { sessionID: "sess-abc" });
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("sess-abc");
    expect(lifecycle.listGoals).toHaveBeenCalledWith("user-1");
  });
});

// ── POST /arcs/list ───────────────────────────────────────────────────────────

describe("POST /arcs/list", () => {
  it("returns { arcs: [] } when arcLifecycle or intelligenceStore is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/arcs/list", { senderId: "user-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.arcs).toEqual([]);
  });

  it("returns { arcs: [] } when only arcLifecycle present but not intelligenceStore", async () => {
    const arcLifecycle = makeArcLifecycle();
    const app = makeApp({ arcLifecycle });
    const res = await post(app, "/arcs/list", { senderId: "user-1" });
    const body = await res.json() as any;
    expect(body.arcs).toEqual([]);
  });

  it("returns arcs for given senderId", async () => {
    const arcLifecycle = makeArcLifecycle();
    const intelligenceStore = makeIntelligenceStore();
    const app = makeApp({ arcLifecycle, intelligenceStore });
    const res = await post(app, "/arcs/list", { senderId: "user-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.arcs).toHaveLength(1);
    expect(intelligenceStore.getArcsBySender).toHaveBeenCalledWith("user-1");
  });

  it("returns empty when senderId cannot be resolved", async () => {
    const arcLifecycle = makeArcLifecycle();
    const intelligenceStore = makeIntelligenceStore();
    const sessionMap = makeSessionMap(null);
    const app = makeApp({ arcLifecycle, intelligenceStore, sessionMap });
    const res = await post(app, "/arcs/list", { sessionID: "missing" });
    const body = await res.json() as any;
    expect(body.arcs).toEqual([]);
  });

  it("resolves senderId from sessionMap when not in body", async () => {
    const arcLifecycle = makeArcLifecycle();
    const intelligenceStore = makeIntelligenceStore();
    const sessionMap = makeSessionMap();
    const app = makeApp({ arcLifecycle, intelligenceStore, sessionMap });
    await post(app, "/arcs/list", { sessionID: "sess-abc" });
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("sess-abc");
    expect(intelligenceStore.getArcsBySender).toHaveBeenCalledWith("user-1");
  });
});

// ── POST /arcs/resolve ────────────────────────────────────────────────────────

describe("POST /arcs/resolve", () => {
  it("returns 503 when arcLifecycle is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/arcs/resolve", { id: "arc-1" });
    expect(res.status).toBe(503);
  });

  it("resolves arc and returns { ok: true }", async () => {
    const arcLifecycle = makeArcLifecycle();
    const app = makeApp({ arcLifecycle });
    const res = await post(app, "/arcs/resolve", { id: "arc-1", summary: "Job found" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(arcLifecycle.resolve).toHaveBeenCalledWith("arc-1", "Job found");
  });

  it("resolves arc without summary", async () => {
    const arcLifecycle = makeArcLifecycle();
    const app = makeApp({ arcLifecycle });
    await post(app, "/arcs/resolve", { id: "arc-2" });
    expect(arcLifecycle.resolve).toHaveBeenCalledWith("arc-2", undefined);
  });
});

// ── POST /arcs/add-memory ─────────────────────────────────────────────────────

describe("POST /arcs/add-memory", () => {
  it("returns 503 when arcDetector is absent", async () => {
    const app = makeApp({});
    const res = await post(app, "/arcs/add-memory", { senderId: "user-1", content: "text" });
    expect(res.status).toBe(503);
  });

  it("returns 400 when senderId cannot be resolved", async () => {
    const arcDetector = makeArcDetector();
    const sessionMap = makeSessionMap(null);
    const app = makeApp({ arcDetector, sessionMap });
    const res = await post(app, "/arcs/add-memory", { sessionID: "missing", content: "text" });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("sender");
  });

  it("processes memory and returns { ok: true } when senderId is in body", async () => {
    const arcDetector = makeArcDetector();
    const app = makeApp({ arcDetector });
    const res = await post(app, "/arcs/add-memory", {
      senderId: "user-1",
      content: "User found a new job",
      memoryId: "mem-1",
      source: "vault",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(arcDetector.processMemory).toHaveBeenCalledWith("user-1", "User found a new job", "mem-1", "vault");
  });

  it("resolves senderId from sessionMap when not in body", async () => {
    const arcDetector = makeArcDetector();
    const sessionMap = makeSessionMap();
    const app = makeApp({ arcDetector, sessionMap });
    const res = await post(app, "/arcs/add-memory", { sessionID: "sess-abc", content: "Some memory" });
    expect(res.status).toBe(200);
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("sess-abc");
    expect(arcDetector.processMemory).toHaveBeenCalledWith("user-1", "Some memory", undefined, "tool");
  });
});

// ── Combined happy-path: all deps present for /session/system-context ────────
describe("POST /session/system-context — combined happy path", () => {
  it("returns both userContext and intelligenceContext when all deps are provided", async () => {
    const sessionMap = makeSessionMap(); // returns entry with senderId="user-1"
    const vaultStore = makeVaultStore({ name: "Alice", timezone: "UTC", language: "en" });
    const vaultSearch = makeVaultSearch([{ content: "User likes TypeScript" }]);
    const promptAssembler = makePromptAssembler();
    const app = makeApp({ vaultStore, vaultSearch, sessionMap, promptAssembler });

    const res = await post(app, "/session/system-context", { sessionID: "sess-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // userContext branch: vaultStore + vaultSearch + sessionMap all present
    expect(body.userContext).toBeTruthy();
    expect(body.userContext).toContain("Alice");

    // intelligenceContext branch: promptAssembler + sessionMap both present
    expect(body.intelligenceContext).toBe("[Intelligence: active goals: 1]");
    expect(promptAssembler.render).toHaveBeenCalled();

    // both branches used the same sessionMap — called twice
    expect(sessionMap.findBySessionId).toHaveBeenCalledTimes(2);
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("sess-1");
  });
});
