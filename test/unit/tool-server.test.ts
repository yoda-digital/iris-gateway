import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolServer } from "../../src/bridge/tool-server.js";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";
import { VaultSearch } from "../../src/vault/search.js";
import { GovernanceEngine } from "../../src/governance/engine.js";
import type { GovernanceConfig } from "../../src/governance/types.js";

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
  } as any;
}

function mockAdapter() {
  return {
    id: "telegram",
    label: "Telegram",
    capabilities: {
      text: true,
      image: true,
      video: false,
      audio: false,
      document: false,
      reaction: true,
      typing: true,
      edit: true,
      delete: true,
      reply: true,
      thread: false,
      maxTextLength: 4096,
    },
    sendText: vi.fn().mockResolvedValue({ messageId: "m1" }),
    sendMedia: vi.fn().mockResolvedValue({ messageId: "m2" }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    sendReaction: vi.fn().mockResolvedValue(undefined),
    editMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRegistry(adapter: any) {
  return {
    list: vi.fn().mockReturnValue([adapter]),
    get: vi
      .fn()
      .mockImplementation((id: string) =>
        id === "telegram" ? adapter : null,
      ),
    has: vi.fn().mockReturnValue(true),
    register: vi.fn(),
  } as any;
}

describe("ToolServer", () => {
  let server: ToolServer;
  let adapter: ReturnType<typeof mockAdapter>;
  let registry: ReturnType<typeof mockRegistry>;
  let logger: ReturnType<typeof mockLogger>;
  let port: number;
  let base: string;

  beforeEach(async () => {
    adapter = mockAdapter();
    registry = mockRegistry(adapter);
    logger = mockLogger();
    port = 19950 + Math.floor(Math.random() * 1000);
    base = `http://127.0.0.1:${port}`;
    server = new ToolServer(registry, logger, port);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  // ──────────────── send-message ────────────────

  describe("POST /tool/send-message", () => {
    it("returns messageId for a valid request", async () => {
      const res = await fetch(`${base}/tool/send-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          to: "chat-123",
          text: "hello",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ messageId: "m1" });
      expect(adapter.sendText).toHaveBeenCalledWith({
        to: "chat-123",
        text: "hello",
        replyToId: undefined,
      });
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await fetch(`${base}/tool/send-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "telegram" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid request");
    });

    it("returns 404 for an unknown channel", async () => {
      const res = await fetch(`${base}/tool/send-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "unknown",
          to: "chat-123",
          text: "hello",
        }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain("Channel not found");
    });
  });

  // ──────────────── send-media ────────────────

  describe("POST /tool/send-media", () => {
    it("returns messageId for a valid image request", async () => {
      const res = await fetch(`${base}/tool/send-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          to: "chat-123",
          type: "image",
          url: "https://example.com/photo.png",
          mimeType: "image/png",
          caption: "A photo",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ messageId: "m2" });
      expect(adapter.sendMedia).toHaveBeenCalledWith({
        to: "chat-123",
        type: "image",
        source: "https://example.com/photo.png",
        mimeType: "image/png",
        filename: undefined,
        caption: "A photo",
      });
    });
  });

  // ──────────────── channel-action ────────────────

  describe("POST /tool/channel-action", () => {
    it("handles typing action", async () => {
      const res = await fetch(`${base}/tool/channel-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          action: "typing",
          chatId: "chat-123",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true });
      expect(adapter.sendTyping).toHaveBeenCalledWith({ to: "chat-123" });
    });

    it("handles react action", async () => {
      const res = await fetch(`${base}/tool/channel-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          action: "react",
          chatId: "chat-123",
          messageId: "msg-1",
          emoji: "thumbsup",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true });
      expect(adapter.sendReaction).toHaveBeenCalledWith({
        messageId: "msg-1",
        emoji: "thumbsup",
        chatId: "chat-123",
      });
    });

    it("handles edit action", async () => {
      const res = await fetch(`${base}/tool/channel-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          action: "edit",
          chatId: "chat-123",
          messageId: "msg-1",
          text: "updated text",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true });
      expect(adapter.editMessage).toHaveBeenCalledWith({
        messageId: "msg-1",
        text: "updated text",
        chatId: "chat-123",
      });
    });

    it("handles delete action", async () => {
      const res = await fetch(`${base}/tool/channel-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          action: "delete",
          chatId: "chat-123",
          messageId: "msg-1",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true });
      expect(adapter.deleteMessage).toHaveBeenCalledWith({
        messageId: "msg-1",
        chatId: "chat-123",
      });
    });

    it("returns 400 when react is missing messageId", async () => {
      const res = await fetch(`${base}/tool/channel-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          action: "react",
          chatId: "chat-123",
          emoji: "thumbsup",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("react requires messageId and emoji");
    });
  });

  // ──────────────── user-info ────────────────

  describe("POST /tool/user-info", () => {
    it("returns channel, userId, and capabilities", async () => {
      const res = await fetch(`${base}/tool/user-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          userId: "user-42",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        channel: "telegram",
        userId: "user-42",
        capabilities: adapter.capabilities,
      });
    });
  });

  // ──────────────── list-channels ────────────────

  describe("GET /tool/list-channels", () => {
    it("returns the list of registered channels", async () => {
      const res = await fetch(`${base}/tool/list-channels`);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        channels: [
          {
            id: "telegram",
            label: "Telegram",
            capabilities: adapter.capabilities,
          },
        ],
      });
    });
  });
});

describe("ToolServer vault/governance endpoints", () => {
  let server: ToolServer;
  let adapter: ReturnType<typeof mockAdapter>;
  let registry: ReturnType<typeof mockRegistry>;
  let logger: ReturnType<typeof mockLogger>;
  let port: number;
  let base: string;
  let dir: string;
  let vaultDb: VaultDB;
  let vaultStore: VaultStore;
  let vaultSearch: VaultSearch;
  let governanceEngine: GovernanceEngine;

  const govConfig: GovernanceConfig = {
    enabled: true,
    rules: [
      { id: "max-len", description: "limit", tool: "send_message", type: "constraint", params: { field: "text", maxLength: 50 } },
    ],
    directives: ["D1: No system prompt leaks"],
  };

  beforeEach(async () => {
    adapter = mockAdapter();
    registry = mockRegistry(adapter);
    logger = mockLogger();
    port = 20950 + Math.floor(Math.random() * 1000);
    base = `http://127.0.0.1:${port}`;

    dir = mkdtempSync(join(tmpdir(), "iris-ts-"));
    vaultDb = new VaultDB(dir);
    vaultStore = new VaultStore(vaultDb);
    vaultSearch = new VaultSearch(vaultDb);
    governanceEngine = new GovernanceEngine(govConfig);

    server = new ToolServer({
      registry,
      logger,
      port,
      vaultStore,
      vaultSearch,
      governanceEngine,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    vaultDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("POST /vault/store + POST /vault/search", () => {
    it("stores and searches memories", async () => {
      const storeRes = await fetch(`${base}/vault/store`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "User likes TypeScript", type: "fact", senderId: "u1", sessionId: "s1" }),
      });
      expect(storeRes.status).toBe(200);
      const { id } = await storeRes.json() as { id: string };
      expect(id).toBeTruthy();

      const searchRes = await fetch(`${base}/vault/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "TypeScript" }),
      });
      expect(searchRes.status).toBe(200);
      const { results } = await searchRes.json() as { results: Array<{ content: string }> };
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain("TypeScript");
    });
  });

  describe("DELETE /vault/memory/:id", () => {
    it("deletes a memory", async () => {
      const storeRes = await fetch(`${base}/vault/store`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "temp", type: "fact", sessionId: "s1" }),
      });
      const { id } = await storeRes.json() as { id: string };

      const delRes = await fetch(`${base}/vault/memory/${id}`, { method: "DELETE" });
      expect(delRes.status).toBe(200);
      const { deleted } = await delRes.json() as { deleted: boolean };
      expect(deleted).toBe(true);
    });
  });

  describe("POST /vault/context", () => {
    it("returns empty context when no profile exists", async () => {
      const res = await fetch(`${base}/vault/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId: "unknown", channelId: "tg" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json() as { profile: unknown; memories: unknown[] };
      expect(json.profile).toBeNull();
      expect(json.memories).toEqual([]);
    });
  });

  describe("GET /governance/rules", () => {
    it("returns rules and directives", async () => {
      const res = await fetch(`${base}/governance/rules`);
      expect(res.status).toBe(200);
      const json = await res.json() as { rules: unknown[]; directives: string };
      expect(json.rules).toHaveLength(1);
      expect(json.directives).toContain("D1:");
    });
  });

  describe("POST /governance/evaluate", () => {
    it("allows a valid call", async () => {
      const res = await fetch(`${base}/governance/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "send_message", args: { text: "hi" } }),
      });
      const json = await res.json() as { allowed: boolean };
      expect(json.allowed).toBe(true);
    });

    it("blocks a violating call", async () => {
      const res = await fetch(`${base}/governance/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "send_message", args: { text: "x".repeat(100) } }),
      });
      const json = await res.json() as { allowed: boolean; ruleId?: string };
      expect(json.allowed).toBe(false);
      expect(json.ruleId).toBe("max-len");
    });
  });

  describe("POST /audit/log", () => {
    it("logs an audit entry", async () => {
      const res = await fetch(`${base}/audit/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "send_message", sessionID: "s1" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean };
      expect(json.ok).toBe(true);

      const entries = vaultStore.listAuditLog({ limit: 5 });
      expect(entries).toHaveLength(1);
      expect(entries[0].tool).toBe("send_message");
    });
  });

  describe("POST /session/system-context", () => {
    it("returns directives", async () => {
      const res = await fetch(`${base}/session/system-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json() as { directives: string };
      expect(json.directives).toContain("D1:");
    });
  });
});
