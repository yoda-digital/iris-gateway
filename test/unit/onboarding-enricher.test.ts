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

  it("detects English from text via tinyld", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "Hello, how are you doing today? I wanted to ask about the weather.",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "language");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("en");
    expect(signal!.confidence).toBeGreaterThan(0.4);
    expect(signal!.confidence).toBeLessThanOrEqual(0.75);
  });

  it("detects French from text via tinyld", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "Bonjour, comment allez-vous aujourd'hui? Je voudrais savoir la météo.",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "language");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("fr");
  });

  it("detects CJK text via tinyld", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "今日はとても良い天気ですね。散歩に行きましょう。",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "language");
    expect(signal).not.toBeNull();
    // tinyld should detect Japanese
    expect(signal!.value).toBe("ja");
  });

  it("skips language detection for short text (<10 chars)", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "hi there",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "language");
    expect(signal).toBeNull();
  });

  it("detects Cyrillic script", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "Привет, как дела?",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "script");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("cyrillic");
    expect(signal!.confidence).toBe(0.9);
  });

  it("detects Arabic script", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "مرحبا، كيف حالك اليوم؟",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "script");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("arabic");
    expect(signal!.confidence).toBe(0.9);
  });

  it("detects Latin script", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "Hello world, this is a test message",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "script");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("latin");
    expect(signal!.confidence).toBe(0.9);
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
