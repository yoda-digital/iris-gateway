import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { UsageTracker } from "../../src/usage/tracker.js";

describe("UsageTracker", () => {
  let db: VaultDB;
  let tracker: UsageTracker;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-usage-"));
    db = new VaultDB(dir);
    tracker = new UsageTracker(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records and retrieves usage", () => {
    tracker.record({
      sessionId: "s1", senderId: "u1", channelId: "tg",
      modelId: "gpt-4", providerId: "openai",
      tokensInput: 100, tokensOutput: 50, tokensReasoning: 0,
      tokensCacheRead: 0, tokensCacheWrite: 0,
      costUsd: 0.005, durationMs: 1200,
    });
    const summary = tracker.summarize({ senderId: "u1" });
    expect(summary.totalTokens).toBe(150);
    expect(summary.totalCost).toBeCloseTo(0.005);
    expect(summary.messageCount).toBe(1);
  });

  it("summarizes multiple records", () => {
    tracker.record({
      sessionId: "s1", senderId: "u1", channelId: "tg",
      modelId: "m", providerId: "p",
      tokensInput: 200, tokensOutput: 100, tokensReasoning: 0,
      tokensCacheRead: 0, tokensCacheWrite: 0,
      costUsd: 0.01, durationMs: null,
    });
    tracker.record({
      sessionId: "s2", senderId: "u1", channelId: "tg",
      modelId: "m", providerId: "p",
      tokensInput: 300, tokensOutput: 150, tokensReasoning: 0,
      tokensCacheRead: 0, tokensCacheWrite: 0,
      costUsd: 0.02, durationMs: null,
    });
    const summary = tracker.summarize({});
    expect(summary.messageCount).toBe(2);
    expect(summary.totalTokens).toBe(750);
    expect(summary.totalCost).toBeCloseTo(0.03);
  });

  it("returns zero summary when empty", () => {
    const summary = tracker.summarize({});
    expect(summary.totalTokens).toBe(0);
    expect(summary.messageCount).toBe(0);
  });
});
