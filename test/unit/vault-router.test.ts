/**
 * Unit tests for src/bridge/routers/vault.ts
 * Uses Hono app.request() — no live server, no ports.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { vaultRouter } from "../../src/bridge/routers/vault.js";
import type { VaultDeps } from "../../src/bridge/routers/vault.js";
import type { VaultStore } from "../../src/vault/store.js";
import type { VaultSearch } from "../../src/vault/search.js";
import type { SessionMap } from "../../src/bridge/session-map.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeVaultStore(): vi.Mocked<VaultStore> {
  return {
    addMemory: vi.fn().mockReturnValue("mem-1"),
    getMemory: vi.fn().mockReturnValue(null),
    listMemories: vi.fn().mockReturnValue([]),
    deleteMemory: vi.fn().mockReturnValue(true),
    purgeExpired: vi.fn().mockReturnValue(0),
    upsertProfile: vi.fn(),
    getProfile: vi.fn().mockReturnValue({ name: "Alice", language: "en" }),
    logAudit: vi.fn(),
    listAuditLog: vi.fn().mockReturnValue([]),
    logGovernance: vi.fn(),
    listGovernanceLog: vi.fn().mockReturnValue([]),
  } as unknown as vi.Mocked<VaultStore>;
}

function makeVaultSearch(): vi.Mocked<VaultSearch> {
  return {
    search: vi.fn().mockReturnValue([{ id: "m1", content: "hello" }]),
  } as unknown as vi.Mocked<VaultSearch>;
}

function makeSessionMap(): vi.Mocked<SessionMap> {
  return {
    buildKey: vi.fn().mockReturnValue("ch:dm:user"),
    resolve: vi.fn().mockResolvedValue(null),
    reset: vi.fn().mockResolvedValue(undefined),
    findBySessionId: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
  } as unknown as vi.Mocked<SessionMap>;
}

function makeApp(deps: VaultDeps) {
  const app = new Hono();
  app.route("/", vaultRouter(deps));
  return app;
}

async function post(app: Hono, path: string, body: unknown = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function del(app: Hono, path: string) {
  return app.request(path, { method: "DELETE" });
}

let vaultStore: vi.Mocked<VaultStore>;
let vaultSearch: vi.Mocked<VaultSearch>;
let sessionMap: vi.Mocked<SessionMap>;

beforeEach(() => {
  vaultStore = makeVaultStore();
  vaultSearch = makeVaultSearch();
  sessionMap = makeSessionMap();
});

// ── POST /vault/search ──────────────────────────────────────────────────────

describe("POST /vault/search", () => {
  it("searches vault and returns results", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/search", {
      query: "hello",
      senderId: "u1",
      channelId: "ch1",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { results: Array<{ id: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe("m1");
    expect(vaultSearch.search).toHaveBeenCalledWith("hello", {
      senderId: "u1",
      channelId: "ch1",
      type: undefined,
      limit: undefined,
    });
  });

  it("defaults query to empty string when missing", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    await post(app, "/vault/search", {});
    expect(vaultSearch.search).toHaveBeenCalledWith("", expect.any(Object));
  });

  it("returns 503 when vaultSearch is null", async () => {
    const app = makeApp({ vaultStore, vaultSearch: null, sessionMap });
    const res = await post(app, "/vault/search", { query: "hi" });
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/vault/i);
  });
});

// ── POST /vault/store ───────────────────────────────────────────────────────

describe("POST /vault/store", () => {
  it("stores a memory and returns its id", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/store", {
      sessionId: "s1",
      channelId: "ch1",
      senderId: "u1",
      type: "fact",
      content: "User likes cats",
      source: "conversation",
      confidence: 0.9,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    expect(body.id).toBe("mem-1");
    expect(vaultStore.addMemory).toHaveBeenCalledWith({
      sessionId: "s1",
      channelId: "ch1",
      senderId: "u1",
      type: "fact",
      content: "User likes cats",
      source: "conversation",
      confidence: 0.9,
      expiresAt: undefined,
    });
  });

  it("uses defaults for optional fields", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    await post(app, "/vault/store", { content: "something" });
    expect(vaultStore.addMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "unknown",
        channelId: null,
        senderId: null,
        type: "fact",
        source: "system",
      }),
    );
  });

  it("returns 503 when vaultStore is null", async () => {
    const app = makeApp({ vaultStore: null, vaultSearch, sessionMap });
    const res = await post(app, "/vault/store", { content: "hello" });
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/vault/i);
  });
});

// ── DELETE /vault/memory/:id ────────────────────────────────────────────────

describe("DELETE /vault/memory/:id", () => {
  it("deletes a memory and returns { deleted: true }", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await del(app, "/vault/memory/mem-42");
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);
    expect(vaultStore.deleteMemory).toHaveBeenCalledWith("mem-42");
  });

  it("returns { deleted: false } when memory not found", async () => {
    vaultStore.deleteMemory.mockReturnValue(false);
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await del(app, "/vault/memory/nonexistent");
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: boolean };
    expect(body.deleted).toBe(false);
  });

  it("returns 503 when vaultStore is null", async () => {
    const app = makeApp({ vaultStore: null, vaultSearch, sessionMap });
    const res = await del(app, "/vault/memory/mem-1");
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/vault/i);
  });
});

// ── POST /vault/context ─────────────────────────────────────────────────────

describe("POST /vault/context", () => {
  it("returns profile and memories for known sender", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/context", {
      senderId: "u1",
      channelId: "ch1",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { profile: unknown; memories: unknown[] };
    expect(body.profile).toEqual({ name: "Alice", language: "en" });
    expect(body.memories).toHaveLength(1);
    expect(vaultStore.getProfile).toHaveBeenCalledWith("u1", "ch1");
    expect(vaultSearch.search).toHaveBeenCalledWith("", { senderId: "u1", limit: 10 });
  });

  it("resolves senderId via sessionMap when senderId missing but sessionID provided", async () => {
    sessionMap.findBySessionId.mockResolvedValue({
      openCodeSessionId: "sess-123",
      senderId: "resolved-user",
      channelId: "resolved-ch",
      chatId: "chat-1",
      chatType: "dm",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/context", { sessionID: "sess-123" });
    expect(res.status).toBe(200);
    const body = await res.json() as { profile: unknown };
    expect(body.profile).toBeDefined();
    expect(sessionMap.findBySessionId).toHaveBeenCalledWith("sess-123");
    expect(vaultStore.getProfile).toHaveBeenCalledWith("resolved-user", "resolved-ch");
    expect(vaultSearch.search).toHaveBeenCalledWith("", { senderId: "resolved-user", limit: 10 });
  });

  it("does not use sessionMap fallback when senderId is already present", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    await post(app, "/vault/context", { senderId: "u1", channelId: "ch1", sessionID: "sess-1" });
    expect(sessionMap.findBySessionId).not.toHaveBeenCalled();
  });

  it("returns null profile and empty memories when no senderId resolved", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/context", {});
    expect(res.status).toBe(200);
    const body = await res.json() as { profile: null; memories: unknown[] };
    expect(body.profile).toBeNull();
    expect(body.memories).toEqual([]);
  });

  it("returns { profile: null, memories: [] } when vaultStore is null", async () => {
    const app = makeApp({ vaultStore: null, vaultSearch, sessionMap });
    const res = await post(app, "/vault/context", { senderId: "u1" });
    expect(res.status).toBe(200);
    const body = await res.json() as { profile: null; memories: unknown[] };
    expect(body.profile).toBeNull();
    expect(body.memories).toEqual([]);
  });

  it("returns { profile: null, memories: [] } when vaultSearch is null", async () => {
    const app = makeApp({ vaultStore, vaultSearch: null, sessionMap });
    const res = await post(app, "/vault/context", { senderId: "u1" });
    expect(res.status).toBe(200);
    const body = await res.json() as { profile: null; memories: unknown[] };
    expect(body.profile).toBeNull();
    expect(body.memories).toEqual([]);
  });

  it("returns empty memories when sessionMap is null and no senderId", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap: null });
    const res = await post(app, "/vault/context", { sessionID: "sess-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as { profile: null; memories: unknown[] };
    expect(body.profile).toBeNull();
    expect(body.memories).toEqual([]);
  });
});

// ── POST /vault/extract ─────────────────────────────────────────────────────
// Pure extraction — no storage, no vaultStore dependency.
// Accepts { sessionID, context: string[] }
// Returns { facts: Array<{ content: string; type: "insight" }> }
// Non-string and empty-string items are filtered out.

describe("POST /vault/extract", () => {
  it("maps string context items to facts with type 'insight'", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/extract", {
      sessionID: "s1",
      context: ["User likes cats", "User is in Berlin"],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { facts: Array<{ content: string; type: string }> };
    expect(body.facts).toEqual([
      { content: "User likes cats", type: "insight" },
      { content: "User is in Berlin", type: "insight" },
    ]);
  });

  it("filters out non-string context items (objects are ignored)", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/extract", {
      sessionID: "s1",
      context: [
        { content: "User is a developer", type: "insight" },
        "User lives in Berlin",
        42,
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { facts: Array<{ content: string; type: string }> };
    expect(body.facts).toEqual([
      { content: "User lives in Berlin", type: "insight" },
    ]);
  });

  it("filters out empty and whitespace-only strings", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/extract", {
      sessionID: "s1",
      context: ["  ", "", "Valid fact"],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { facts: Array<{ content: string; type: string }> };
    expect(body.facts).toEqual([{ content: "Valid fact", type: "insight" }]);
  });

  it("returns { facts: [] } when context is empty array", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/extract", { sessionID: "s1", context: [] });
    expect(res.status).toBe(200);
    const body = await res.json() as { facts: Array<{ content: string; type: string }> };
    expect(body.facts).toEqual([]);
  });

  it("returns { facts: [] } when context is missing (not an array)", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/extract", { sessionID: "s1" });
    expect(res.status).toBe(200);
    const body = await res.json() as { facts: Array<{ content: string; type: string }> };
    expect(body.facts).toEqual([]);
  });

  it("does not call vaultStore (pure extraction — no storage)", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    await post(app, "/vault/extract", {
      sessionID: "s1",
      context: ["A fact"],
    });
    expect(vaultStore.addMemory).not.toHaveBeenCalled();
  });
});

// ── POST /vault/store-batch ─────────────────────────────────────────────────

describe("POST /vault/store-batch", () => {
  it("stores multiple memories and returns their ids", async () => {
    let counter = 0;
    vaultStore.addMemory.mockImplementation(() => `mem-${++counter}`);
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/store-batch", {
      sessionID: "s1",
      memories: [
        { content: "fact A", senderId: "u1", channelId: "ch1", type: "fact" },
        { content: "fact B", senderId: "u2" },
        { content: "fact C" },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ids: string[] };
    expect(body.ids).toEqual(["mem-1", "mem-2", "mem-3"]);
    expect(vaultStore.addMemory).toHaveBeenCalledTimes(3);
  });

  it("uses sessionId fallback when sessionID not provided", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    await post(app, "/vault/store-batch", {
      sessionId: "s-fallback",
      memories: [{ content: "x" }],
    });
    expect(vaultStore.addMemory).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s-fallback" }),
    );
  });

  it("defaults type to 'insight' and source to 'extracted'", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    await post(app, "/vault/store-batch", {
      memories: [{ content: "y" }],
    });
    expect(vaultStore.addMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "insight",
        source: "extracted",
        sessionId: "unknown",
      }),
    );
  });

  it("returns { ids: [] } when no memories provided", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/store-batch", {});
    expect(res.status).toBe(200);
    const body = await res.json() as { ids: string[] };
    expect(body.ids).toEqual([]);
    expect(vaultStore.addMemory).not.toHaveBeenCalled();
  });

  it("returns { ids: [] } when vaultStore is null", async () => {
    const app = makeApp({ vaultStore: null, vaultSearch, sessionMap });
    const res = await post(app, "/vault/store-batch", {
      memories: [{ content: "ignored" }],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ids: string[] };
    expect(body.ids).toEqual([]);
  });
});

// ── POST /vault/profile ─────────────────────────────────────────────────────

describe("POST /vault/profile", () => {
  it("upserts profile and returns { ok: true }", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/profile", {
      senderId: "u1",
      channelId: "ch1",
      name: "Alice",
      timezone: "Europe/Berlin",
      language: "de",
      preferences: { theme: "dark" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(vaultStore.upsertProfile).toHaveBeenCalledWith({
      senderId: "u1",
      channelId: "ch1",
      name: "Alice",
      timezone: "Europe/Berlin",
      language: "de",
      preferences: { theme: "dark" },
    });
  });

  it("defaults optional profile fields to null", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    await post(app, "/vault/profile", { senderId: "u1", channelId: "ch1" });
    expect(vaultStore.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: null,
        timezone: null,
        language: null,
      }),
    );
  });

  it("returns 400 when senderId missing", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/profile", { channelId: "ch1" });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/senderId/);
  });

  it("returns 400 when channelId missing", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/profile", { senderId: "u1" });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/channelId/);
  });

  it("returns 400 when both senderId and channelId missing", async () => {
    const app = makeApp({ vaultStore, vaultSearch, sessionMap });
    const res = await post(app, "/vault/profile", { name: "Bob" });
    expect(res.status).toBe(400);
  });

  it("returns { ok: false } when vaultStore is null", async () => {
    const app = makeApp({ vaultStore: null, vaultSearch, sessionMap });
    const res = await post(app, "/vault/profile", {
      senderId: "u1",
      channelId: "ch1",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
