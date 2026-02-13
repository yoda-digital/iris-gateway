import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { SignalStore } from "../../src/onboarding/signals.js";

describe("SignalStore", () => {
  let dir: string;
  let db: VaultDB;
  let store: SignalStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-signals-"));
    db = new VaultDB(dir);
    store = new SignalStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds and retrieves signals", () => {
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "Europe/Berlin",
      confidence: 0.8,
    });
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "language",
      value: "de",
      confidence: 0.9,
    });

    const signals = store.getSignals("user1", "telegram");
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.signalType)).toContain("timezone");
    expect(signals.map((s) => s.signalType)).toContain("language");
  });

  it("gets latest signal by type", () => {
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "America/New_York",
      confidence: 0.6,
    });
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "Europe/Berlin",
      confidence: 0.9,
    });

    const latest = store.getLatestSignal("user1", "telegram", "timezone");
    expect(latest).not.toBeNull();
    expect(latest!.value).toBe("Europe/Berlin");
  });

  it("purges old signals", () => {
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "UTC",
    });

    const purged = store.purgeOlderThan(0);
    expect(purged).toBe(1);

    const signals = store.getSignals("user1", "telegram");
    expect(signals).toHaveLength(0);
  });

  it("consolidates signals into highest-confidence map", () => {
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "America/New_York",
      confidence: 0.6,
    });
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "Europe/Berlin",
      confidence: 0.95,
    });
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "language",
      value: "en",
      confidence: 0.5,
    });
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "language",
      value: "de",
      confidence: 0.85,
    });

    const consolidated = store.consolidate("user1", "telegram");
    expect(consolidated.size).toBe(2);
    expect(consolidated.get("timezone")).toBe("Europe/Berlin");
    expect(consolidated.get("language")).toBe("de");
  });
});
