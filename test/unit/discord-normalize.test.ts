import { describe, it, expect } from "vitest";
import { normalizeDiscordMessage } from "../../src/channels/discord/normalize.js";

function mockMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    author: {
      id: "user-1",
      bot: false,
      displayName: "TestUser",
      username: "testuser",
    },
    member: { displayName: "ServerNick" },
    channel: {
      id: "ch-1",
      isDMBased: () => false,
    },
    content: "Hello world",
    reference: null,
    createdTimestamp: 1700000000000,
    ...overrides,
  } as any;
}

describe("normalizeDiscordMessage", () => {
  it("normalizes a group message", () => {
    const msg = mockMessage();
    const result = normalizeDiscordMessage(msg);
    expect(result).toEqual({
      id: "msg-1",
      channelId: "discord",
      senderId: "user-1",
      senderName: "ServerNick",
      chatId: "ch-1",
      chatType: "group",
      text: "Hello world",
      replyToId: undefined,
      timestamp: 1700000000000,
      raw: msg,
    });
  });

  it("normalizes a DM message", () => {
    const msg = mockMessage({
      channel: { id: "dm-1", isDMBased: () => true },
    });
    const result = normalizeDiscordMessage(msg);
    expect(result?.chatType).toBe("dm");
  });

  it("returns null for bot messages", () => {
    const msg = mockMessage({
      author: { id: "bot-1", bot: true, displayName: "Bot", username: "bot" },
    });
    expect(normalizeDiscordMessage(msg)).toBeNull();
  });

  it("uses displayName when no member nickname", () => {
    const msg = mockMessage({ member: null });
    const result = normalizeDiscordMessage(msg);
    expect(result?.senderName).toBe("TestUser");
  });

  it("uses username as last fallback", () => {
    const msg = mockMessage({
      member: null,
      author: { id: "u1", bot: false, displayName: undefined, username: "fallback" },
    });
    const result = normalizeDiscordMessage(msg);
    expect(result?.senderName).toBe("fallback");
  });

  it("sets text to undefined when content is empty", () => {
    const msg = mockMessage({ content: "" });
    const result = normalizeDiscordMessage(msg);
    expect(result?.text).toBeUndefined();
  });

  it("extracts replyToId from reference", () => {
    const msg = mockMessage({
      reference: { messageId: "ref-42" },
    });
    const result = normalizeDiscordMessage(msg);
    expect(result?.replyToId).toBe("ref-42");
  });
});
