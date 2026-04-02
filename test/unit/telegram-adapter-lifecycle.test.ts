/**
 * test/unit/telegram-adapter-lifecycle.test.ts
 *
 * Tests for TelegramAdapter lifecycle and message methods (issue #242).
 * Covers sendText, sendMedia, sendTyping, editMessage, deleteMessage,
 * sendReaction, stop, and skipConflictCheck path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramAdapter } from "../../src/channels/telegram/index.js";

// ─── Mock grammy ───────────────────────────────────────────────────────────────
vi.mock("grammy", () => ({
  Bot: vi.fn(),
  GrammyError: class GrammyError extends Error {
    error_code: number;
    description: string;
    constructor(message: string, error_code: number, description: string) {
      super(message);
      this.name = "GrammyError";
      this.error_code = error_code;
      this.description = description;
    }
  },
  InputFile: vi.fn((src) => ({ _src: src })),
}));

import { Bot } from "grammy";
const MockBot = vi.mocked(Bot);

// ─── Mock send module ──────────────────────────────────────────────────────────
vi.mock("../../src/channels/telegram/send.js", () => ({
  sendText: vi.fn().mockResolvedValue({ messageId: "100" }),
  sendMedia: vi.fn().mockResolvedValue({ messageId: "101" }),
  sendTyping: vi.fn().mockResolvedValue(undefined),
  editMessage: vi.fn().mockResolvedValue(undefined),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  sendReaction: vi.fn().mockResolvedValue(undefined),
}));

import * as sendMod from "../../src/channels/telegram/send.js";

// ─── Mock normalize ────────────────────────────────────────────────────────────
vi.mock("../../src/channels/telegram/normalize.js", () => ({
  normalizeTelegramMessage: vi.fn().mockReturnValue(null),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────
function makeBotMock(overrides: {
  getMeResult?: object;
  getUpdatesResult?: unknown[];
} = {}) {
  return {
    on: vi.fn(),
    catch: vi.fn(),
    start: vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ })),
    stop: vi.fn(),
    api: {
      getMe: vi.fn().mockResolvedValue(
        overrides.getMeResult ?? { id: 42, is_bot: true, first_name: "TestBot", username: "test_bot" }
      ),
      getUpdates: vi.fn().mockResolvedValue(overrides.getUpdatesResult ?? []),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
      sendPhoto: vi.fn().mockResolvedValue({ message_id: 101 }),
      sendVideo: vi.fn().mockResolvedValue({ message_id: 101 }),
      sendAudio: vi.fn().mockResolvedValue({ message_id: 101 }),
      sendDocument: vi.fn().mockResolvedValue({ message_id: 101 }),
      sendChatAction: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue(true),
      setMessageReaction: vi.fn().mockResolvedValue(true),
    },
  };
}

function makeMessageCache() {
  const store = new Map<string, { channelId: string; chatId: string; timestamp: number }>();
  return {
    set: vi.fn((id, val) => store.set(id, val)),
    get: vi.fn((id) => store.get(id)),
    _store: store,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────
describe("TelegramAdapter — lifecycle", () => {
  beforeEach(() => {
    MockBot.mockClear();
    vi.mocked(sendMod.sendText).mockResolvedValue({ messageId: "100" });
    vi.mocked(sendMod.sendMedia).mockResolvedValue({ messageId: "101" });
    vi.mocked(sendMod.sendTyping).mockResolvedValue(undefined);
    vi.mocked(sendMod.editMessage).mockResolvedValue(undefined);
    vi.mocked(sendMod.deleteMessage).mockResolvedValue(undefined);
    vi.mocked(sendMod.sendReaction).mockResolvedValue(undefined);
  });

  it("start() sets isConnected=true and emits connected", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const connected = vi.fn();
    adapter.events.on("connected", connected);

    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    expect(adapter.isConnected).toBe(true);
    expect(connected).toHaveBeenCalledOnce();
  });

  it("stop() sets isConnected=false and emits disconnected", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    const disconnected = vi.fn();
    adapter.events.on("disconnected", disconnected);

    await adapter.stop();

    expect(adapter.isConnected).toBe(false);
    expect(disconnected).toHaveBeenCalledWith("stopped");
    expect(mockBot.stop).toHaveBeenCalledOnce();
  });

  it("start() with skipConflictCheck=true skips getUpdates preflight", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal, { skipConflictCheck: true });

    expect(mockBot.api.getUpdates).not.toHaveBeenCalled();
    expect(adapter.isConnected).toBe(true);
  });

  it("start() throws if no token provided", async () => {
    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await expect(adapter.start({} as never, signal)).rejects.toThrow("Telegram bot token is required");
  });

  it("isConnected is false before start()", () => {
    const adapter = new TelegramAdapter();
    expect(adapter.isConnected).toBe(false);
  });
});

describe("TelegramAdapter — sendText", () => {
  beforeEach(() => MockBot.mockClear());

  it("calls send.sendText and caches the message", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);
    const cache = makeMessageCache();

    const adapter = new TelegramAdapter();
    adapter.setMessageCache(cache as never);
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    const result = await adapter.sendText({ to: "12345", text: "Hello" });

    expect(sendMod.sendText).toHaveBeenCalledWith(expect.anything(), "12345", "Hello", undefined, undefined, undefined);
    expect(result.messageId).toBe("100");
    expect(cache.set).toHaveBeenCalledWith("100", expect.objectContaining({ chatId: "12345" }));
  });

  it("throws if bot not started", async () => {
    const adapter = new TelegramAdapter();
    await expect(adapter.sendText({ to: "12345", text: "Hello" })).rejects.toThrow("Telegram bot not started");
  });
});

describe("TelegramAdapter — sendTyping", () => {
  beforeEach(() => MockBot.mockClear());

  it("calls send.sendTyping", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await adapter.sendTyping({ to: "12345" });

    expect(sendMod.sendTyping).toHaveBeenCalledWith(expect.anything(), "12345");
  });

  it("throws if bot not started", async () => {
    const adapter = new TelegramAdapter();
    await expect(adapter.sendTyping({ to: "12345" })).rejects.toThrow("Telegram bot not started");
  });
});

describe("TelegramAdapter — sendMedia", () => {
  beforeEach(() => MockBot.mockClear());

  it("calls send.sendMedia and caches result", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);
    const cache = makeMessageCache();

    const adapter = new TelegramAdapter();
    adapter.setMessageCache(cache as never);
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    const result = await adapter.sendMedia({ to: "12345", type: "image", source: "https://img.example.com/photo.jpg" });

    expect(sendMod.sendMedia).toHaveBeenCalled();
    expect(result.messageId).toBe("101");
    expect(cache.set).toHaveBeenCalledWith("101", expect.objectContaining({ chatId: "12345" }));
  });

  it("throws if bot not started", async () => {
    const adapter = new TelegramAdapter();
    await expect(adapter.sendMedia({ to: "12345", type: "image", source: "url" })).rejects.toThrow("Telegram bot not started");
  });
});

describe("TelegramAdapter — editMessage", () => {
  beforeEach(() => MockBot.mockClear());

  it("uses chatId from cache when not provided", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);
    const cache = makeMessageCache();
    cache._store.set("100", { channelId: "telegram", chatId: "99999", timestamp: Date.now() });

    const adapter = new TelegramAdapter();
    adapter.setMessageCache(cache as never);
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await adapter.editMessage({ messageId: "100", text: "edited" });

    expect(sendMod.editMessage).toHaveBeenCalledWith(expect.anything(), "99999", "100", "edited");
  });

  it("uses explicit chatId when provided", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await adapter.editMessage({ messageId: "100", text: "edited", chatId: "explicit-chat" });

    expect(sendMod.editMessage).toHaveBeenCalledWith(expect.anything(), "explicit-chat", "100", "edited");
  });

  it("throws if chatId cannot be resolved", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await expect(adapter.editMessage({ messageId: "999", text: "nope" })).rejects.toThrow("Cannot resolve chatId for edit");
  });

  it("throws if bot not started", async () => {
    const adapter = new TelegramAdapter();
    await expect(adapter.editMessage({ messageId: "1", text: "x" })).rejects.toThrow("Telegram bot not started");
  });
});

describe("TelegramAdapter — deleteMessage", () => {
  beforeEach(() => MockBot.mockClear());

  it("uses chatId from cache", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);
    const cache = makeMessageCache();
    cache._store.set("100", { channelId: "telegram", chatId: "77777", timestamp: Date.now() });

    const adapter = new TelegramAdapter();
    adapter.setMessageCache(cache as never);
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await adapter.deleteMessage({ messageId: "100" });

    expect(sendMod.deleteMessage).toHaveBeenCalledWith(expect.anything(), "77777", "100");
  });

  it("uses explicit chatId", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await adapter.deleteMessage({ messageId: "100", chatId: "explicit" });

    expect(sendMod.deleteMessage).toHaveBeenCalledWith(expect.anything(), "explicit", "100");
  });

  it("throws if chatId cannot be resolved", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await expect(adapter.deleteMessage({ messageId: "999" })).rejects.toThrow("Cannot resolve chatId for delete");
  });

  it("throws if bot not started", async () => {
    const adapter = new TelegramAdapter();
    await expect(adapter.deleteMessage({ messageId: "1" })).rejects.toThrow("Telegram bot not started");
  });
});

describe("TelegramAdapter — sendReaction", () => {
  beforeEach(() => MockBot.mockClear());

  it("uses chatId from cache", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);
    const cache = makeMessageCache();
    cache._store.set("100", { channelId: "telegram", chatId: "55555", timestamp: Date.now() });

    const adapter = new TelegramAdapter();
    adapter.setMessageCache(cache as never);
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await adapter.sendReaction({ messageId: "100", emoji: "👍" });

    expect(sendMod.sendReaction).toHaveBeenCalledWith(expect.anything(), "55555", "100", "👍");
  });

  it("uses explicit chatId", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await adapter.sendReaction({ messageId: "100", emoji: "❤️", chatId: "explicit" });

    expect(sendMod.sendReaction).toHaveBeenCalledWith(expect.anything(), "explicit", "100", "❤️");
  });

  it("throws if chatId cannot be resolved", async () => {
    const mockBot = makeBotMock();
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);
    await adapter.start({ token: "fake-token" }, signal);

    await expect(adapter.sendReaction({ messageId: "999", emoji: "🔥" })).rejects.toThrow("Cannot resolve chatId for reaction");
  });

  it("throws if bot not started", async () => {
    const adapter = new TelegramAdapter();
    await expect(adapter.sendReaction({ messageId: "1", emoji: "👍" })).rejects.toThrow("Telegram bot not started");
  });
});
