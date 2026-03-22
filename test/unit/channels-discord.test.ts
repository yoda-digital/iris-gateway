import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordAdapter } from "../../src/channels/discord/index.js";

// Mock createDiscordClient
vi.mock("../../src/channels/discord/client.js", () => ({
  createDiscordClient: vi.fn(),
}));

// Mock normalizeDiscordMessage
vi.mock("../../src/channels/discord/normalize.js", () => ({
  normalizeDiscordMessage: vi.fn((msg) => ({
    id: msg.id ?? "msg-1",
    channelId: "discord",
    senderId: "user-1",
    senderName: "TestUser",
    chatId: "ch-1",
    chatType: "group",
    text: msg.content ?? "hello",
    replyToId: undefined,
    timestamp: Date.now(),
    raw: msg,
  })),
}));

// Mock send module
vi.mock("../../src/channels/discord/send.js", () => ({
  sendText: vi.fn().mockResolvedValue({ messageId: "sent-1" }),
  sendTyping: vi.fn().mockResolvedValue(undefined),
  sendMedia: vi.fn().mockResolvedValue({ messageId: "media-1" }),
  editMessage: vi.fn().mockResolvedValue(undefined),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  sendReaction: vi.fn().mockResolvedValue(undefined),
}));

import { createDiscordClient } from "../../src/channels/discord/client.js";
import { normalizeDiscordMessage } from "../../src/channels/discord/normalize.js";
import * as send from "../../src/channels/discord/send.js";

function makeClient() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mockClient = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    login: vi.fn().mockResolvedValue("TOKEN"),
    destroy: vi.fn(),
    _emit: (event: string, ...args: unknown[]) => {
      handlers[event]?.forEach((h) => h(...args));
    },
  };
  vi.mocked(createDiscordClient).mockReturnValue(mockClient as any);
  return mockClient;
}

describe("DiscordAdapter", () => {
  let adapter: DiscordAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new DiscordAdapter();
  });

  it("has correct id and label", () => {
    expect(adapter.id).toBe("discord");
    expect(adapter.label).toBe("Discord");
  });

  it("isConnected starts false", () => {
    expect(adapter.isConnected).toBe(false);
  });

  it("start() throws if no token", async () => {
    const client = makeClient();
    const ctrl = new AbortController();
    await expect(adapter.start({} as any, ctrl.signal)).rejects.toThrow(
      "Discord bot token is required"
    );
  });

  it("start() sets up event listeners and calls login", async () => {
    const mockClient = makeClient();
    const ctrl = new AbortController();

    const startPromise = adapter.start({ token: "tok-123" } as any, ctrl.signal);

    // login resolves immediately
    await startPromise;

    expect(createDiscordClient).toHaveBeenCalled();
    expect(mockClient.on).toHaveBeenCalledWith("ready", expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith("messageCreate", expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(mockClient.login).toHaveBeenCalledWith("tok-123");
  });

  it("ready event sets isConnected and emits connected", async () => {
    const mockClient = makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    const connectedSpy = vi.fn();
    adapter.events.on("connected", connectedSpy);

    mockClient._emit("ready");

    expect(adapter.isConnected).toBe(true);
    expect(connectedSpy).toHaveBeenCalled();
  });

  it("messageCreate emits message when normalized", async () => {
    const mockClient = makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    const messageSpy = vi.fn();
    adapter.events.on("message", messageSpy);

    const discordMsg = { id: "dm-1", content: "hi" };
    mockClient._emit("messageCreate", discordMsg);

    expect(normalizeDiscordMessage).toHaveBeenCalledWith(discordMsg);
    expect(messageSpy).toHaveBeenCalled();
  });

  it("messageCreate skips emit when normalize returns null", async () => {
    const mockClient = makeClient();
    vi.mocked(normalizeDiscordMessage).mockReturnValueOnce(null);
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    const messageSpy = vi.fn();
    adapter.events.on("message", messageSpy);

    mockClient._emit("messageCreate", {});
    expect(messageSpy).not.toHaveBeenCalled();
  });

  it("error event emits error", async () => {
    const mockClient = makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    const errorSpy = vi.fn();
    adapter.events.on("error", errorSpy);

    const err = new Error("discord error");
    mockClient._emit("error", err);
    expect(errorSpy).toHaveBeenCalledWith(err);
  });

  it("abort signal destroys client", async () => {
    const mockClient = makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    ctrl.abort();
    expect(mockClient.destroy).toHaveBeenCalled();
  });

  it("stop() destroys client and emits disconnected", async () => {
    const mockClient = makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    const disconnectedSpy = vi.fn();
    adapter.events.on("disconnected", disconnectedSpy);

    await adapter.stop();

    expect(mockClient.destroy).toHaveBeenCalled();
    expect(adapter.isConnected).toBe(false);
    expect(disconnectedSpy).toHaveBeenCalledWith("stopped");
  });

  it("stop() when never started does not throw", async () => {
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it("sendText() throws if client not started", async () => {
    await expect(
      adapter.sendText({ to: "ch-1", text: "hi" })
    ).rejects.toThrow("Discord client not started");
  });

  it("sendText() delegates to send.sendText", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    const result = await adapter.sendText({ to: "ch-1", text: "hello" });
    expect(send.sendText).toHaveBeenCalledWith(expect.any(Object), "ch-1", "hello", undefined);
    expect(result).toEqual({ messageId: "sent-1" });
  });

  it("sendText() sets messageCache when available", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    const cache = { set: vi.fn(), get: vi.fn() };
    adapter.setMessageCache(cache as any);

    await adapter.sendText({ to: "ch-1", text: "hello" });
    expect(cache.set).toHaveBeenCalledWith("sent-1", expect.objectContaining({ channelId: "discord", chatId: "ch-1" }));
  });

  it("sendTyping() throws if client not started", async () => {
    await expect(adapter.sendTyping({ to: "ch-1" })).rejects.toThrow("Discord client not started");
  });

  it("sendTyping() delegates to send.sendTyping", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    await adapter.sendTyping({ to: "ch-1" });
    expect(send.sendTyping).toHaveBeenCalled();
  });

  it("sendMedia() throws if client not started", async () => {
    await expect(
      adapter.sendMedia({ to: "ch-1", media: "url", mimeType: "image/png" } as any)
    ).rejects.toThrow("Discord client not started");
  });

  it("sendMedia() delegates and caches", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    const cache = { set: vi.fn(), get: vi.fn() };
    adapter.setMessageCache(cache as any);

    await adapter.sendMedia({ to: "ch-1", media: "url", mimeType: "image/png" } as any);
    expect(send.sendMedia).toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalledWith("media-1", expect.any(Object));
  });

  it("editMessage() throws if client not started", async () => {
    await expect(
      adapter.editMessage({ messageId: "m1", text: "new" })
    ).rejects.toThrow("Discord client not started");
  });

  it("editMessage() uses chatId from params", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    await adapter.editMessage({ messageId: "m1", text: "new", chatId: "ch-1" });
    expect(send.editMessage).toHaveBeenCalledWith(expect.any(Object), "ch-1", "m1", "new");
  });

  it("editMessage() falls back to cache for channelId", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    const cache = { get: vi.fn().mockReturnValue({ chatId: "ch-cache" }), set: vi.fn() };
    adapter.setMessageCache(cache as any);

    await adapter.editMessage({ messageId: "m1", text: "new" });
    expect(send.editMessage).toHaveBeenCalledWith(expect.any(Object), "ch-cache", "m1", "new");
  });

  it("editMessage() throws if no channelId can be resolved", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    await expect(adapter.editMessage({ messageId: "m1", text: "new" })).rejects.toThrow(
      "Cannot resolve channelId for edit"
    );
  });

  it("deleteMessage() throws if client not started", async () => {
    await expect(
      adapter.deleteMessage({ messageId: "m1" })
    ).rejects.toThrow("Discord client not started");
  });

  it("deleteMessage() uses chatId from params", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    await adapter.deleteMessage({ messageId: "m1", chatId: "ch-1" });
    expect(send.deleteMessage).toHaveBeenCalled();
  });

  it("deleteMessage() throws if no channelId", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    await expect(adapter.deleteMessage({ messageId: "m1" })).rejects.toThrow(
      "Cannot resolve channelId for delete"
    );
  });

  it("sendReaction() throws if client not started", async () => {
    await expect(
      adapter.sendReaction({ messageId: "m1", emoji: "👍" })
    ).rejects.toThrow("Discord client not started");
  });

  it("sendReaction() uses chatId from params", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    await adapter.sendReaction({ messageId: "m1", emoji: "👍", chatId: "ch-1" });
    expect(send.sendReaction).toHaveBeenCalled();
  });

  it("sendReaction() throws if no channelId", async () => {
    makeClient();
    const ctrl = new AbortController();
    await adapter.start({ token: "tok" } as any, ctrl.signal);

    await expect(adapter.sendReaction({ messageId: "m1", emoji: "👍" })).rejects.toThrow(
      "Cannot resolve channelId for reaction"
    );
  });
});
