import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ToolServer } from "../../src/bridge/tool-server.js";

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
