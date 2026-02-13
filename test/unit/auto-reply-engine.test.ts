import { describe, it, expect } from "vitest";
import { TemplateEngine } from "../../src/auto-reply/engine.js";
import type { InboundMessage } from "../../src/channels/adapter.js";

const msg = (text: string, overrides?: Partial<InboundMessage>): InboundMessage => ({
  id: "1", channelId: "telegram", senderId: "user1", senderName: "Test",
  chatId: "chat1", chatType: "dm", text, timestamp: Date.now(), raw: null, ...overrides,
});

describe("TemplateEngine", () => {
  it("matches exact trigger (case-insensitive)", () => {
    const engine = new TemplateEngine([
      { id: "start", trigger: { type: "exact", pattern: "/start" }, response: "Welcome!" },
    ]);
    const match = engine.match(msg("/start"));
    expect(match).not.toBeNull();
    expect(match!.response).toBe("Welcome!");
  });

  it("matches regex trigger", () => {
    const engine = new TemplateEngine([
      { id: "price", trigger: { type: "regex", pattern: "how much|price|cost" }, response: "Check pricing.com" },
    ]);
    expect(engine.match(msg("How much does it cost?"))).not.toBeNull();
    expect(engine.match(msg("What time is it?"))).toBeNull();
  });

  it("matches keyword trigger", () => {
    const engine = new TemplateEngine([
      { id: "help", trigger: { type: "keyword", words: ["help", "assist"] }, response: "How can I help?" },
    ]);
    expect(engine.match(msg("I need help please"))).not.toBeNull();
    expect(engine.match(msg("Hello there"))).toBeNull();
  });

  it("matches command trigger", () => {
    const engine = new TemplateEngine([
      { id: "status", trigger: { type: "command", name: "status" }, response: "All systems go." },
    ]);
    expect(engine.match(msg("/status"))).not.toBeNull();
    expect(engine.match(msg("check status"))).toBeNull();
  });

  it("interpolates variables", () => {
    const engine = new TemplateEngine([
      { id: "greet", trigger: { type: "exact", pattern: "hi" }, response: "Hello {sender.name}!" },
    ]);
    const match = engine.match(msg("hi", { senderName: "Alice" }));
    expect(match!.response).toBe("Hello Alice!");
  });

  it("respects priority order", () => {
    const engine = new TemplateEngine([
      { id: "low", trigger: { type: "keyword", words: ["help"] }, response: "Low priority", priority: 1 },
      { id: "high", trigger: { type: "keyword", words: ["help"] }, response: "High priority", priority: 10 },
    ]);
    expect(engine.match(msg("help"))!.response).toBe("High priority");
  });

  it("respects channel filter", () => {
    const engine = new TemplateEngine([
      { id: "tg-only", trigger: { type: "exact", pattern: "hi" }, response: "TG!", channels: ["telegram"] },
    ]);
    expect(engine.match(msg("hi", { channelId: "telegram" }))).not.toBeNull();
    expect(engine.match(msg("hi", { channelId: "discord" }))).toBeNull();
  });

  it("enforces cooldown", () => {
    const engine = new TemplateEngine([
      { id: "cool", trigger: { type: "exact", pattern: "hi" }, response: "Hey!", cooldown: 60 },
    ]);
    expect(engine.match(msg("hi"))).not.toBeNull();
    expect(engine.match(msg("hi"))).toBeNull(); // Cooldown active
  });

  it("enforces once per sender", () => {
    const engine = new TemplateEngine([
      { id: "once", trigger: { type: "exact", pattern: "hi" }, response: "First time!", once: true },
    ]);
    expect(engine.match(msg("hi"))).not.toBeNull();
    expect(engine.match(msg("hi"))).toBeNull();
  });
});
