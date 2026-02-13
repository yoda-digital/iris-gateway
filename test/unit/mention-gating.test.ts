import { describe, it, expect } from "vitest";
import { shouldProcessGroupMessage, stripBotMention } from "../../src/channels/mention-gating.js";
import { makeInboundMessage } from "../helpers/fixtures.js";

describe("shouldProcessGroupMessage", () => {
  it("always returns true for DM messages", () => {
    const msg = makeInboundMessage({ chatType: "dm", text: "no mention here" });
    expect(shouldProcessGroupMessage(msg, "mybot")).toBe(true);
  });

  it("returns true when bot is @mentioned in a group message", () => {
    const msg = makeInboundMessage({ chatType: "group", text: "Hey @mybot what is up?" });
    expect(shouldProcessGroupMessage(msg, "mybot")).toBe(true);
  });

  it("returns false when bot is not mentioned in a group message", () => {
    const msg = makeInboundMessage({ chatType: "group", text: "Hello everyone" });
    expect(shouldProcessGroupMessage(msg, "mybot")).toBe(false);
  });

  it("matches case-insensitively by default", () => {
    const msg = makeInboundMessage({ chatType: "group", text: "Hey @MyBot help me" });
    expect(shouldProcessGroupMessage(msg, "mybot")).toBe(true);
  });

  it("uses custom mentionPattern (string) when provided", () => {
    const msg = makeInboundMessage({ chatType: "group", text: "!bot do something" });
    expect(shouldProcessGroupMessage(msg, "mybot", "!bot\\b")).toBe(true);
  });

  it("uses custom mentionPattern (RegExp) when provided", () => {
    const msg = makeInboundMessage({ chatType: "group", text: "hey iris, help" });
    expect(shouldProcessGroupMessage(msg, "mybot", /\biris\b/i)).toBe(true);
  });

  it("returns false when custom pattern does not match", () => {
    const msg = makeInboundMessage({ chatType: "group", text: "hello there" });
    expect(shouldProcessGroupMessage(msg, "mybot", /\biris\b/i)).toBe(false);
  });

  it("handles messages with no text gracefully", () => {
    const msg = makeInboundMessage({ chatType: "group", text: undefined });
    expect(shouldProcessGroupMessage(msg, "mybot")).toBe(false);
  });

  it("handles multiple mentions of the bot", () => {
    const msg = makeInboundMessage({
      chatType: "group",
      text: "@mybot hey @mybot please respond",
    });
    expect(shouldProcessGroupMessage(msg, "mybot")).toBe(true);
  });
});

describe("stripBotMention", () => {
  it("removes the @mention from text", () => {
    expect(stripBotMention("@mybot what is the weather?", "mybot")).toBe(
      "what is the weather?",
    );
  });

  it("removes all occurrences of the mention", () => {
    expect(stripBotMention("@mybot hello @mybot", "mybot")).toBe("hello");
  });

  it("cleans up extra whitespace after removal", () => {
    expect(stripBotMention("Hey  @mybot  do something", "mybot")).toBe(
      "Hey do something",
    );
  });

  it("handles case-insensitive removal", () => {
    expect(stripBotMention("@MyBot help me", "mybot")).toBe("help me");
  });

  it("strips using custom mentionPattern (string)", () => {
    expect(stripBotMention("!bot do something", "mybot", "!bot\\b")).toBe(
      "do something",
    );
  });

  it("strips using custom mentionPattern (RegExp)", () => {
    expect(stripBotMention("hey iris, help", "mybot", /\biris\b/gi)).toBe(
      "hey , help",
    );
  });

  it("returns original text if no mention found", () => {
    expect(stripBotMention("hello world", "mybot")).toBe("hello world");
  });
});
