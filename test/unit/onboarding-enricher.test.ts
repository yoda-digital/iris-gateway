import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";
import { SignalStore } from "../../src/onboarding/signals.js";
import { ProfileEnricher } from "../../src/onboarding/enricher.js";

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
  } as any;
}

describe("ProfileEnricher", () => {
  let dir: string;
  let db: VaultDB;
  let vaultStore: VaultStore;
  let signalStore: SignalStore;
  let enricher: ProfileEnricher;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-enricher-"));
    db = new VaultDB(dir);
    vaultStore = new VaultStore(db);
    signalStore = new SignalStore(db);
    enricher = new ProfileEnricher(signalStore, vaultStore, mockLogger());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects language from text", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "Salut, cum esti?",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "language");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("ro");
    expect(signal!.confidence).toBe(0.6);
  });

  it("infers active hours from timestamp", () => {
    const ts = new Date("2025-06-15T14:30:00Z").getTime();

    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "hello",
      timestamp: ts,
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "active_hour");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("14");
  });

  it("detects name from self-introduction", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "Hi, I'm Alexander",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "name");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("Alexander");
    expect(signal!.confidence).toBe(0.8);
  });

  it("detects response style (short messages)", () => {
    for (let i = 0; i < 5; i++) {
      enricher.enrich({
        senderId: "user1",
        channelId: "telegram",
        text: "ok",
        timestamp: Date.now(),
      });
    }

    const signal = signalStore.getLatestSignal("user1", "telegram", "response_style");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("concise");
  });

  it("consolidates signals into profile", () => {
    signalStore.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "language",
      value: "ro",
      confidence: 0.6,
    });
    signalStore.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "name",
      value: "Alex",
      confidence: 0.8,
    });

    enricher.consolidateProfile("user1", "telegram");

    const profile = vaultStore.getProfile("user1", "telegram");
    expect(profile).not.toBeNull();
    expect(profile!.language).toBe("ro");
    expect(profile!.name).toBe("Alex");
  });

  it("isFirstContact returns true for brand new user", () => {
    vaultStore.upsertProfile({
      senderId: "user1",
      channelId: "telegram",
    });

    const profile = vaultStore.getProfile("user1", "telegram");
    expect(profile).not.toBeNull();
    expect(enricher.isFirstContact(profile!)).toBe(true);
  });

  it("isFirstContact returns false for returning user", () => {
    const now = Date.now();
    const sixtySecondsAgo = now - 60_000;

    // Insert profile manually with first_seen in the past
    db.raw()
      .prepare(
        `INSERT INTO profiles (sender_id, channel_id, preferences, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("user1", "telegram", "{}", sixtySecondsAgo, sixtySecondsAgo);

    const profile = vaultStore.getProfile("user1", "telegram");
    expect(profile).not.toBeNull();
    expect(enricher.isFirstContact(profile!)).toBe(false);
  });
});
