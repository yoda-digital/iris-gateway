import { describe, it, expect } from "vitest";
import { TemplateEngine } from "../../src/auto-reply/engine.js";
import type { AutoReplyTemplate } from "../../src/auto-reply/types.js";
import type { InboundMessage } from "../../src/channels/adapter.js";

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "msg-1",
    channelId: "telegram",
    senderId: "user-1",
    senderName: "Alice",
    chatId: "chat-1",
    chatType: "dm",
    text: "",
    timestamp: Date.now(),
    raw: null,
    ...overrides,
  };
}

describe("Integration: Auto-Reply Pipeline", () => {
  const templates: AutoReplyTemplate[] = [
    {
      id: "greeting",
      trigger: { type: "keyword", words: ["hello", "hi", "hey"] },
      response: "Hello {sender.name}! How can I help you today?",
      priority: 10,
    },
    {
      id: "hours",
      trigger: { type: "regex", pattern: "office hours|business hours|when.*open" },
      response: "Our office hours are Monday-Friday, 9am-5pm.",
      priority: 5,
    },
    {
      id: "help-cmd",
      trigger: { type: "command", name: "help" },
      response: "Available commands: /help, /status, /contact",
      priority: 20,
    },
  ];

  it("matches keyword trigger and interpolates variables", () => {
    const engine = new TemplateEngine(templates);
    const match = engine.match(makeMsg({ text: "Hello there!" }));

    expect(match).not.toBeNull();
    expect(match!.template.id).toBe("greeting");
    expect(match!.response).toBe("Hello Alice! How can I help you today?");
  });

  it("matches regex trigger", () => {
    const engine = new TemplateEngine(templates);
    const match = engine.match(makeMsg({
      text: "What are your office hours?",
      senderId: "user-2",
      senderName: "Bob",
      channelId: "slack",
    }));

    expect(match).not.toBeNull();
    expect(match!.template.id).toBe("hours");
    expect(match!.response).toContain("Monday-Friday");
  });

  it("matches command trigger", () => {
    const engine = new TemplateEngine(templates);
    const match = engine.match(makeMsg({
      text: "/help",
      senderId: "user-3",
      senderName: "Carol",
      channelId: "discord",
    }));

    expect(match).not.toBeNull();
    expect(match!.template.id).toBe("help-cmd");
    expect(match!.response).toContain("/help, /status, /contact");
  });

  it("returns null for non-matching messages", () => {
    const engine = new TemplateEngine(templates);
    const match = engine.match(makeMsg({
      text: "What is the weather like?",
      senderId: "user-4",
      senderName: "Dave",
    }));

    expect(match).toBeNull();
  });

  it("respects channel filter", () => {
    const filtered: AutoReplyTemplate[] = [
      {
        id: "telegram-only",
        trigger: { type: "exact", pattern: "ping" },
        response: "pong",
        priority: 1,
        channels: ["telegram"],
      },
    ];

    const engine = new TemplateEngine(filtered);

    // Should match on telegram
    const telegramMatch = engine.match(makeMsg({ text: "ping", channelId: "telegram" }));
    expect(telegramMatch).not.toBeNull();

    // Should NOT match on discord
    const discordMatch = engine.match(makeMsg({ text: "ping", channelId: "discord" }));
    expect(discordMatch).toBeNull();
  });

  it("respects cooldown period", () => {
    const cooldownTemplates: AutoReplyTemplate[] = [
      {
        id: "rate-limited",
        trigger: { type: "exact", pattern: "spam" },
        response: "Only once per minute!",
        priority: 1,
        cooldown: 60, // 60 seconds
      },
    ];

    const engine = new TemplateEngine(cooldownTemplates);
    const msg = makeMsg({ text: "spam", senderId: "spammer" });

    // First match should work
    const first = engine.match(msg);
    expect(first).not.toBeNull();

    // Second match should be blocked by cooldown
    const second = engine.match(msg);
    expect(second).toBeNull();
  });
});
