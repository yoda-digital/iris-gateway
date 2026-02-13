import { describe, it, expect } from "vitest";
import { normalizeSlackMessage } from "../../src/channels/slack/normalize.js";

describe("normalizeSlackMessage", () => {
  it("normalizes a DM message", () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Hello",
      ts: "1700000000.000000",
      channel: "D456",
      channel_type: "im",
    };
    const result = normalizeSlackMessage(event);
    expect(result).toEqual({
      id: "1700000000.000000",
      channelId: "slack",
      senderId: "U123",
      senderName: "U123",
      chatId: "D456",
      chatType: "dm",
      text: "Hello",
      replyToId: undefined,
      timestamp: 1700000000000,
      raw: event,
    });
  });

  it("normalizes a group message", () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Hi team",
      ts: "1700000000.000000",
      channel: "C789",
      channel_type: "channel",
    };
    const result = normalizeSlackMessage(event);
    expect(result?.chatType).toBe("group");
  });

  it("returns null for subtype messages", () => {
    const event = {
      type: "message",
      subtype: "channel_join",
      user: "U123",
      ts: "1700000000.000000",
      channel: "C789",
    };
    expect(normalizeSlackMessage(event)).toBeNull();
  });

  it("returns null for bot messages", () => {
    const event = {
      type: "message",
      bot_id: "B123",
      user: "U123",
      ts: "1700000000.000000",
      channel: "C789",
    };
    expect(normalizeSlackMessage(event)).toBeNull();
  });

  it("returns null when user is missing", () => {
    const event = {
      type: "message",
      ts: "1700000000.000000",
      channel: "C789",
    };
    expect(normalizeSlackMessage(event)).toBeNull();
  });

  it("extracts thread_ts as replyToId", () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Threaded reply",
      ts: "1700000001.000000",
      thread_ts: "1700000000.000000",
      channel: "C789",
    };
    const result = normalizeSlackMessage(event);
    expect(result?.replyToId).toBe("1700000000.000000");
  });

  it("sets text to undefined when not present", () => {
    const event = {
      type: "message",
      user: "U123",
      ts: "1700000000.000000",
      channel: "C789",
    };
    const result = normalizeSlackMessage(event);
    expect(result?.text).toBeUndefined();
  });
});
