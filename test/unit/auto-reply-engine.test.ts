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

  it("respects chatType filter — dm only", () => {
    const engine = new TemplateEngine([
      { id: "dm-only", trigger: { type: "exact", pattern: "hi" }, response: "DM!", chatTypes: ["dm"] },
    ]);
    expect(engine.match(msg("hi", { chatType: "dm" }))).not.toBeNull();
    expect(engine.match(msg("hi", { chatType: "group" }))).toBeNull();
  });

  it("respects chatType filter — group only", () => {
    const engine = new TemplateEngine([
      { id: "group-only", trigger: { type: "exact", pattern: "hi" }, response: "Group!", chatTypes: ["group"] },
    ]);
    expect(engine.match(msg("hi", { chatType: "group" }))).not.toBeNull();
    expect(engine.match(msg("hi", { chatType: "dm" }))).toBeNull();
  });

  it("respects chatType filter — dm and group", () => {
    const engine = new TemplateEngine([
      { id: "both", trigger: { type: "exact", pattern: "hi" }, response: "Both!", chatTypes: ["dm", "group"] },
    ]);
    expect(engine.match(msg("hi", { chatType: "dm" }))).not.toBeNull();
    expect(engine.match(msg("hi", { chatType: "group" }))).not.toBeNull();
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

  describe("schedule trigger with timezone", () => {
    it("uses server local time when no timezone specified", () => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay();

      const engine = new TemplateEngine([
        {
          id: "sched",
          trigger: {
            type: "schedule",
            when: { hours: [currentHour, currentHour + 1], days: [currentDay] },
          },
          response: "Scheduled!",
        },
      ]);
      expect(engine.match(msg("anything"))).not.toBeNull();
    });

    it("uses timezone-aware hour when timezone is specified", () => {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        hour: "numeric",
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const utcHour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);

      const engine = new TemplateEngine([
        {
          id: "utc-sched",
          trigger: {
            type: "schedule",
            when: { hours: [utcHour, utcHour + 1], timezone: "UTC" },
          },
          response: "UTC time match!",
        },
      ]);
      expect(engine.match(msg("test"))).not.toBeNull();
    });

    it("falls back to local time for invalid timezone string", () => {
      const now = new Date();
      const currentHour = now.getHours();

      const engine = new TemplateEngine([
        {
          id: "bad-tz",
          trigger: {
            type: "schedule",
            when: { hours: [currentHour, currentHour + 1], timezone: "Invalid/Timezone_ZZZ" },
          },
          response: "Fallback!",
        },
      ]);
      expect(() => engine.match(msg("test"))).not.toThrow();
      expect(engine.match(msg("test"))).not.toBeNull();
    });
  });
});
