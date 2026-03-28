import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildIntentPrompt,
  buildTriggerPrompt,
  isQuietHours,
} from "../../src/proactive/pulse-prompts.js";
import type { ProactiveConfig, ProactiveIntent, ProactiveTrigger } from "../../src/proactive/types.js";
import type { VaultStore } from "../../src/vault/store.js";

function mockVaultStore(profile: { name?: string; timezone?: string; language?: string } | null = null) {
  return {
    getProfile: vi.fn().mockReturnValue(profile),
  } as unknown as VaultStore;
}

function makeIntent(overrides: Partial<ProactiveIntent> = {}): ProactiveIntent {
  return {
    id: "intent-1",
    senderId: "user1",
    channelId: "telegram",
    what: "Check on the report",
    why: "User mentioned deadline",
    createdAt: Date.now() - 2 * 3_600_000, // 2 hours ago
    ...overrides,
  } as ProactiveIntent;
}

function makeTrigger(overrides: Partial<ProactiveTrigger> = {}): ProactiveTrigger {
  return {
    id: "trigger-1",
    senderId: "user1",
    channelId: "telegram",
    type: "follow_up",
    context: "User asked about project status",
    ...overrides,
  } as ProactiveTrigger;
}

const baseConfig: ProactiveConfig = {
  quietHours: { start: 23, end: 7 },
} as ProactiveConfig;

// ──────────────────────────────────────────────────────────────────────────────
// buildIntentPrompt
// ──────────────────────────────────────────────────────────────────────────────
describe("buildIntentPrompt", () => {
  it("includes intent text and reason", () => {
    const store = mockVaultStore(null);
    const intent = makeIntent();
    const result = buildIntentPrompt(intent, store, 0.5, 2, 10);
    expect(result).toContain("Check on the report");
    expect(result).toContain("User mentioned deadline");
  });

  it("shows hours ago when elapsed < 24h", () => {
    const store = mockVaultStore(null);
    const intent = makeIntent({ createdAt: Date.now() - 3 * 3_600_000 });
    const result = buildIntentPrompt(intent, store, 0.5, 2, 10);
    expect(result).toContain("hours ago");
  });

  it("shows days ago when elapsed >= 24h", () => {
    const store = mockVaultStore(null);
    const intent = makeIntent({ createdAt: Date.now() - 25 * 3_600_000 });
    const result = buildIntentPrompt(intent, store, 0.5, 2, 10);
    expect(result).toContain("days ago");
  });

  it("includes quota and engagement rate", () => {
    const store = mockVaultStore(null);
    const intent = makeIntent();
    const result = buildIntentPrompt(intent, store, 0.75, 3, 10);
    expect(result).toContain("7/10");
    expect(result).toContain("75%");
  });

  it("renders profile block when profile exists", () => {
    const store = mockVaultStore({ name: "Alice", timezone: "Europe/London", language: "en" });
    const intent = makeIntent();
    const result = buildIntentPrompt(intent, store, 0.5, 0, 10);
    expect(result).toContain("Alice");
    expect(result).toContain("Europe/London");
  });

  it("renders unknown block when profile is null", () => {
    const store = mockVaultStore(null);
    const intent = makeIntent();
    const result = buildIntentPrompt(intent, store, 0.5, 0, 10);
    expect(result).toContain("User: unknown");
  });

  it("omits Reason line when why is falsy", () => {
    const store = mockVaultStore(null);
    const intent = makeIntent({ why: undefined });
    const result = buildIntentPrompt(intent, store, 0.5, 0, 10);
    expect(result).not.toContain("Reason:");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// buildTriggerPrompt
// ──────────────────────────────────────────────────────────────────────────────
describe("buildTriggerPrompt", () => {
  it("includes trigger context", () => {
    const store = mockVaultStore(null);
    const trigger = makeTrigger();
    const result = buildTriggerPrompt(trigger, store, 0.5, 2, 10);
    expect(result).toContain("User asked about project status");
  });

  it("formats trigger type in upper-case with spaces", () => {
    const store = mockVaultStore(null);
    const trigger = makeTrigger({ type: "follow_up" });
    const result = buildTriggerPrompt(trigger, store, 0.5, 2, 10);
    expect(result).toContain("FOLLOW UP");
  });

  it("includes quota and engagement rate", () => {
    const store = mockVaultStore(null);
    const trigger = makeTrigger();
    const result = buildTriggerPrompt(trigger, store, 0.4, 1, 5);
    expect(result).toContain("4/5");
    expect(result).toContain("40%");
  });

  it("renders profile block when profile exists", () => {
    const store = mockVaultStore({ name: "Bob", timezone: "America/New_York", language: "en" });
    const trigger = makeTrigger();
    const result = buildTriggerPrompt(trigger, store, 0.5, 0, 10);
    expect(result).toContain("Bob");
    expect(result).toContain("America/New_York");
  });

  it("renders unknown block when profile is null", () => {
    const store = mockVaultStore(null);
    const trigger = makeTrigger();
    const result = buildTriggerPrompt(trigger, store, 0.5, 0, 10);
    expect(result).toContain("User: unknown");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isQuietHours
// ──────────────────────────────────────────────────────────────────────────────
describe("isQuietHours", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when hour is within range (start < end)", () => {
    // start=9, end=17 → quiet during working hours
    vi.setSystemTime(new Date("2026-03-28T12:00:00Z")); // 12 UTC
    const store = mockVaultStore(null);
    const config = { quietHours: { start: 9, end: 17 } } as ProactiveConfig;
    expect(isQuietHours("u1", "c1", store, config)).toBe(true);
  });

  it("returns false when hour is outside range (start < end)", () => {
    vi.setSystemTime(new Date("2026-03-28T20:00:00Z")); // 20 UTC
    const store = mockVaultStore(null);
    const config = { quietHours: { start: 9, end: 17 } } as ProactiveConfig;
    expect(isQuietHours("u1", "c1", store, config)).toBe(false);
  });

  it("returns true for overnight range — hour >= start", () => {
    // start=23, end=7 — overnight quiet hours
    vi.setSystemTime(new Date("2026-03-28T23:30:00Z")); // 23 UTC
    const store = mockVaultStore(null);
    expect(isQuietHours("u1", "c1", store, baseConfig)).toBe(true);
  });

  it("returns true for overnight range — hour < end", () => {
    vi.setSystemTime(new Date("2026-03-28T03:00:00Z")); // 3 UTC → 5 local, < end=7
    const store = mockVaultStore(null);
    expect(isQuietHours("u1", "c1", store, baseConfig)).toBe(true);
  });

  it("returns false for overnight range — hour outside both bounds", () => {
    vi.setSystemTime(new Date("2026-03-28T14:00:00Z")); // 14 UTC
    const store = mockVaultStore(null);
    expect(isQuietHours("u1", "c1", store, baseConfig)).toBe(false);
  });

  it("falls back to UTC when timezone is invalid", () => {
    vi.setSystemTime(new Date("2026-03-28T23:00:00Z")); // 23 UTC → quiet
    const store = mockVaultStore({ timezone: "Invalid/Zone" });
    expect(isQuietHours("u1", "c1", store, baseConfig)).toBe(true);
  });

  it("uses UTC hour when profile has no timezone", () => {
    vi.setSystemTime(new Date("2026-03-28T23:00:00Z")); // 23 UTC → quiet
    const store = mockVaultStore({ name: "Alice" }); // no timezone
    expect(isQuietHours("u1", "c1", store, baseConfig)).toBe(true);
  });

  it("uses UTC hour when profile is null", () => {
    vi.setSystemTime(new Date("2026-03-28T14:00:00Z")); // 14 UTC → not quiet
    const store = mockVaultStore(null);
    expect(isQuietHours("u1", "c1", store, baseConfig)).toBe(false);
  });
});
