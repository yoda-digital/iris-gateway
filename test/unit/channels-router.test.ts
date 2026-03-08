/**
 * Unit tests for src/bridge/routers/channels.ts
 * Uses Hono app.request() — no live server, no ports.
 * Uses MockAdapter from test/helpers for channel operations.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { channelsRouter } from "../../src/bridge/routers/channels.js";
import type { ChannelsDeps } from "../../src/bridge/routers/channels.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { MockAdapter } from "../helpers/mock-adapter.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

function makeApp(deps: Partial<ChannelsDeps> & { registry: ChannelRegistry; logger: any }) {
  const app = new Hono();
  app.route("/", channelsRouter(deps as ChannelsDeps));
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

let registry: ChannelRegistry;
let adapter: MockAdapter;
let logger: ReturnType<typeof makeLogger>;

beforeEach(() => {
  registry = new ChannelRegistry();
  adapter = new MockAdapter("tg", "Telegram");
  logger = makeLogger();
});

// ── POST /tool/send-message ───────────────────────────────────────────────────

describe("POST /tool/send-message", () => {
  it("sends a text message via adapter and returns result", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/send-message", {
      channel: "tg",
      to: "chat-123",
      text: "Hello world",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.messageId).toMatch(/^mock-/);
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].method).toBe("sendText");
  });

  it("returns 400 on validation failure — missing text", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/send-message", { channel: "tg", to: "chat-1" });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/invalid/i);
  });

  it("returns 404 when channel not found", async () => {
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/send-message", { channel: "unknown", to: "chat-1", text: "hi" });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain("unknown");
  });

  it("returns 500 and logs when adapter throws", async () => {
    const throws = new MockAdapter("bad", "Bad");
    vi.spyOn(throws, "sendText").mockRejectedValue(new Error("network error"));
    registry.register(throws);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/send-message", { channel: "bad", to: "chat-1", text: "hi" });
    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });

  it("forwards replyToId to adapter", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    await post(app, "/tool/send-message", { channel: "tg", to: "chat-1", text: "reply", replyToId: "msg-99" });
    const call = adapter.calls[0];
    expect((call.args[0] as any).replyToId).toBe("msg-99");
  });
});

// ── POST /tool/send-media ─────────────────────────────────────────────────────

describe("POST /tool/send-media", () => {
  it("sends media via adapter when sendMedia is supported", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/send-media", {
      channel: "tg",
      to: "chat-1",
      type: "image",
      url: "https://example.com/img.png",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.messageId).toMatch(/^mock-/);
  });

  it("returns 400 on validation failure — invalid type", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/send-media", {
      channel: "tg",
      to: "chat-1",
      type: "sticker",
      url: "https://example.com/s.webp",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when channel not found", async () => {
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/send-media", { channel: "none", to: "c", type: "image", url: "u" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when adapter does not support sendMedia", async () => {
    // Create adapter without sendMedia
    const noMedia = new MockAdapter("nomedia", "No Media");
    delete (noMedia as any).sendMedia;
    registry.register(noMedia);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/send-media", {
      channel: "nomedia",
      to: "c",
      type: "image",
      url: "u",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("media");
  });

  it("returns 500 and logs when adapter.sendMedia throws", async () => {
    vi.spyOn(adapter, "sendMedia").mockRejectedValue(new Error("upload failed"));
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/send-media", {
      channel: "tg",
      to: "chat-1",
      type: "image",
      url: "https://example.com/img.png",
    });
    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });
});

// ── POST /tool/channel-action ─────────────────────────────────────────────────

describe("POST /tool/channel-action", () => {
  it("returns 400 on invalid schema — missing channel", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", { action: "typing", chatId: "c" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when channel not found", async () => {
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", { channel: "x", action: "typing", chatId: "c" });
    expect(res.status).toBe(404);
  });

  it("typing action — calls sendTyping and returns { ok: true }", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", { channel: "tg", action: "typing", chatId: "chat-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(adapter.calls.some((c) => c.method === "sendTyping")).toBe(true);
  });

  it("typing action — returns 400 when adapter does not support typing", async () => {
    const noTyping = new MockAdapter("nt", "No Typing");
    delete (noTyping as any).sendTyping;
    registry.register(noTyping);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", { channel: "nt", action: "typing", chatId: "c" });
    expect(res.status).toBe(400);
  });

  it("react action — returns 400 when messageId or emoji missing", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", {
      channel: "tg",
      action: "react",
      chatId: "c",
      messageId: "m1",
      // no emoji
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("emoji");
  });

  it("react action — returns 400 when adapter does not support reactions", async () => {
    registry.register(adapter); // MockAdapter has no sendReaction
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", {
      channel: "tg",
      action: "react",
      chatId: "c",
      messageId: "m1",
      emoji: "👍",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("reactions");
  });

  it("edit action — returns 400 when messageId or text missing", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", {
      channel: "tg",
      action: "edit",
      chatId: "c",
      messageId: "m1",
      // no text
    });
    expect(res.status).toBe(400);
  });

  it("edit action — returns 400 when adapter does not support edit", async () => {
    registry.register(adapter); // MockAdapter has no editMessage
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", {
      channel: "tg",
      action: "edit",
      chatId: "c",
      messageId: "m1",
      text: "updated text",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("edit");
  });

  it("delete action — returns 400 when messageId missing", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", {
      channel: "tg",
      action: "delete",
      chatId: "c",
    });
    expect(res.status).toBe(400);
  });

  it("delete action — returns 400 when adapter does not support delete", async () => {
    registry.register(adapter); // MockAdapter has no deleteMessage
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", {
      channel: "tg",
      action: "delete",
      chatId: "c",
      messageId: "m1",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("delete");
  });

  it("returns 500 and logs when adapter action throws", async () => {
    vi.spyOn(adapter, "sendTyping").mockRejectedValue(new Error("timeout"));
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/channel-action", { channel: "tg", action: "typing", chatId: "c" });
    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });
});

// ── POST /tool/user-info ──────────────────────────────────────────────────────

describe("POST /tool/user-info", () => {
  it("returns user info and capabilities", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/user-info", { channel: "tg", userId: "user-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.channel).toBe("tg");
    expect(body.userId).toBe("user-1");
    expect(body.capabilities).toBeDefined();
    expect(body.capabilities.text).toBe(true);
  });

  it("returns 400 on validation failure", async () => {
    registry.register(adapter);
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/user-info", { channel: "tg" }); // missing userId
    expect(res.status).toBe(400);
  });

  it("returns 404 when channel not found", async () => {
    const app = makeApp({ registry, logger });
    const res = await post(app, "/tool/user-info", { channel: "none", userId: "u1" });
    expect(res.status).toBe(404);
  });
});

// ── GET /tool/list-channels ───────────────────────────────────────────────────

describe("GET /tool/list-channels", () => {
  it("returns empty channels when registry is empty", async () => {
    const app = makeApp({ registry, logger });
    const res = await get(app, "/tool/list-channels");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.channels).toEqual([]);
  });

  it("returns list of registered channels with id, label, capabilities", async () => {
    registry.register(adapter);
    registry.register(new MockAdapter("discord", "Discord"));
    const app = makeApp({ registry, logger });
    const res = await get(app, "/tool/list-channels");
    const body = await res.json() as any;
    expect(body.channels).toHaveLength(2);
    expect(body.channels[0]).toHaveProperty("id");
    expect(body.channels[0]).toHaveProperty("label");
    expect(body.channels[0]).toHaveProperty("capabilities");
  });
});

// ── POST /tool/plugin/:name ───────────────────────────────────────────────────

describe("POST /tool/plugin/:name", () => {
  it("returns 404 when plugin tool not found", async () => {
    const app = makeApp({ registry, logger, pluginTools: null });
    const res = await post(app, "/tool/plugin/nonexistent", {});
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain("nonexistent");
  });

  it("executes plugin tool and returns result", async () => {
    const mockTool = {
      description: "Test plugin tool",
      execute: vi.fn().mockResolvedValue({ data: "processed" }),
    };
    const pluginTools = new Map([["my-tool", mockTool]]);
    const app = makeApp({ registry, logger, pluginTools });
    const res = await post(app, "/tool/plugin/my-tool", { sessionId: "s1", payload: "test" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBe("processed");
    expect(mockTool.execute).toHaveBeenCalled();
  });

  it("returns { ok: true } when plugin execute returns null/undefined", async () => {
    const mockTool = {
      description: "Null tool",
      execute: vi.fn().mockResolvedValue(null),
    };
    const pluginTools = new Map([["null-tool", mockTool]]);
    const app = makeApp({ registry, logger, pluginTools });
    const res = await post(app, "/tool/plugin/null-tool", {});
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it("returns 500 and logs when plugin execute throws", async () => {
    const mockTool = {
      description: "Faulty tool",
      execute: vi.fn().mockRejectedValue(new Error("plugin exploded")),
    };
    const pluginTools = new Map([["bad-tool", mockTool]]);
    const app = makeApp({ registry, logger, pluginTools });
    const res = await post(app, "/tool/plugin/bad-tool", {});
    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });
});

// ── GET /tool/plugin-manifest ─────────────────────────────────────────────────

describe("GET /tool/plugin-manifest", () => {
  it("returns empty tools when pluginTools is null", async () => {
    const app = makeApp({ registry, logger, pluginTools: null });
    const res = await get(app, "/tool/plugin-manifest");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.tools).toEqual({});
  });

  it("returns empty tools when pluginTools map is empty", async () => {
    const app = makeApp({ registry, logger, pluginTools: new Map() });
    const res = await get(app, "/tool/plugin-manifest");
    const body = await res.json() as any;
    expect(body.tools).toEqual({});
  });

  it("returns manifest with tool descriptions", async () => {
    const pluginTools = new Map([
      ["tool-a", { description: "Does A", execute: vi.fn() }],
      ["tool-b", { description: "Does B", execute: vi.fn() }],
    ]);
    const app = makeApp({ registry, logger, pluginTools });
    const res = await get(app, "/tool/plugin-manifest");
    const body = await res.json() as any;
    expect(body.tools["tool-a"].description).toBe("Does A");
    expect(body.tools["tool-b"].description).toBe("Does B");
  });
});
