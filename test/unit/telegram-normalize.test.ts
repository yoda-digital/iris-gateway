import { describe, it, expect } from "vitest";
import { normalizeTelegramMessage } from "../../src/channels/telegram/normalize.js";

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      message_id: 123,
      date: 1700000000,
      chat: { id: 456, type: "private" },
      from: { id: 789, first_name: "Alice", last_name: "Smith" },
      text: "Hello bot",
      ...overrides,
    },
  } as Parameters<typeof normalizeTelegramMessage>[0];
}

describe("normalizeTelegramMessage", () => {
  it("normalizes a private text message", () => {
    const result = normalizeTelegramMessage(makeCtx());
    expect(result).toEqual({
      id: "123",
      channelId: "telegram",
      senderId: "789",
      senderName: "Alice Smith",
      chatId: "456",
      chatType: "dm",
      text: "Hello bot",
      replyToId: undefined,
      timestamp: 1700000000000,
      raw: expect.any(Object),
    });
  });

  it("normalizes a group message", () => {
    const result = normalizeTelegramMessage(
      makeCtx({ chat: { id: 100, type: "group" } }),
    );
    expect(result?.chatType).toBe("group");
    expect(result?.chatId).toBe("100");
  });

  it("normalizes a supergroup message", () => {
    const result = normalizeTelegramMessage(
      makeCtx({ chat: { id: 200, type: "supergroup" } }),
    );
    expect(result?.chatType).toBe("group");
  });

  it("uses caption when text is absent", () => {
    const result = normalizeTelegramMessage(
      makeCtx({ text: undefined, caption: "Photo caption" }),
    );
    expect(result?.text).toBe("Photo caption");
  });

  it("handles sender with no last name", () => {
    const result = normalizeTelegramMessage(
      makeCtx({ from: { id: 1, first_name: "Bob" } }),
    );
    expect(result?.senderName).toBe("Bob");
  });

  it("includes replyToId when present", () => {
    const result = normalizeTelegramMessage(
      makeCtx({ reply_to_message: { message_id: 99 } }),
    );
    expect(result?.replyToId).toBe("99");
  });

  it("returns null when no message", () => {
    const ctx = {} as Parameters<typeof normalizeTelegramMessage>[0];
    expect(normalizeTelegramMessage(ctx)).toBeNull();
  });

  it("returns null when no from field", () => {
    const ctx = {
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 1, type: "private" },
        from: undefined,
        text: "test",
      },
    } as unknown as Parameters<typeof normalizeTelegramMessage>[0];
    expect(normalizeTelegramMessage(ctx)).toBeNull();
  });

  it("handles edited messages", () => {
    const ctx = {
      editedMessage: {
        message_id: 42,
        date: 1700000001,
        chat: { id: 10, type: "private" },
        from: { id: 5, first_name: "Eve" },
        text: "edited text",
      },
    } as unknown as Parameters<typeof normalizeTelegramMessage>[0];
    const result = normalizeTelegramMessage(ctx);
    expect(result?.id).toBe("42");
    expect(result?.text).toBe("edited text");
  });
});
