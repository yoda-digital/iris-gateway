import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { IntentStore } from "../../src/proactive/store.js";

describe("IntentStore", () => {
  let dir: string;
  let db: VaultDB;
  let store: IntentStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-proactive-"));
    db = new VaultDB(dir);
    store = new IntentStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("schema", () => {
    it("creates proactive_intents table", () => {
      const row = db.raw().prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='proactive_intents'"
      ).get() as { name: string } | undefined;
      expect(row?.name).toBe("proactive_intents");
    });

    it("creates proactive_triggers table", () => {
      const row = db.raw().prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='proactive_triggers'"
      ).get() as { name: string } | undefined;
      expect(row?.name).toBe("proactive_triggers");
    });

    it("creates proactive_log table", () => {
      const row = db.raw().prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='proactive_log'"
      ).get() as { name: string } | undefined;
      expect(row?.name).toBe("proactive_log");
    });
  });

  describe("intents", () => {
    it("adds and retrieves an intent", () => {
      const id = store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "check if user fixed server",
        why: "user committed to fixing",
        confidence: 0.9,
        executeAt: Date.now() + 86_400_000,
      });
      expect(id).toBeTruthy();

      // Not yet ready (future execute_at)
      const pending = store.listPendingIntents();
      expect(pending).toHaveLength(0);
    });

    it("only lists intents past their execute_at time", () => {
      store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "future intent",
        executeAt: Date.now() + 999_999_999,
      });
      store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "ready intent",
        executeAt: Date.now() - 1000,
      });

      const pending = store.listPendingIntents();
      expect(pending).toHaveLength(1);
      expect(pending[0].what).toBe("ready intent");
    });

    it("marks intent as executed", () => {
      const id = store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "test",
        executeAt: Date.now() - 1000,
      });

      store.markIntentExecuted(id, "sent");
      const pending = store.listPendingIntents();
      expect(pending).toHaveLength(0);
    });

    it("cancels an intent", () => {
      const id = store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "cancel me",
        executeAt: Date.now() - 1000,
      });

      expect(store.cancelIntent(id)).toBe(true);
      expect(store.listPendingIntents()).toHaveLength(0);
    });
  });

  describe("triggers", () => {
    it("adds and lists pending triggers", () => {
      store.addTrigger({
        type: "dormant_user",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        context: "User inactive for 7 days",
        executeAt: Date.now() - 1000,
      });

      const pending = store.listPendingTriggers();
      expect(pending).toHaveLength(1);
      expect(pending[0].type).toBe("dormant_user");
    });

    it("detects pending trigger for sender", () => {
      store.addTrigger({
        type: "dormant_user",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        context: "first",
        executeAt: Date.now() + 999_999,
      });

      expect(store.hasPendingTrigger("user1", "dormant_user")).toBe(true);
      expect(store.hasPendingTrigger("user2", "dormant_user")).toBe(false);
    });
  });

  describe("quota + engagement", () => {
    it("tracks proactive messages and enforces soft quota", () => {
      const status1 = store.getQuotaStatus("user1", "telegram", 3);
      expect(status1.allowed).toBe(true);
      expect(status1.sentToday).toBe(0);

      store.logProactiveMessage({
        senderId: "user1",
        channelId: "telegram",
        type: "intent",
        sourceId: "src1",
      });

      const status2 = store.getQuotaStatus("user1", "telegram", 3);
      expect(status2.sentToday).toBe(1);
      expect(status2.allowed).toBe(true);
    });

    it("reports not allowed when quota exceeded", () => {
      for (let i = 0; i < 3; i++) {
        store.logProactiveMessage({
          senderId: "user1",
          channelId: "telegram",
          type: "intent",
          sourceId: `src${i}`,
        });
      }

      const status = store.getQuotaStatus("user1", "telegram", 3);
      expect(status.allowed).toBe(false);
      expect(status.sentToday).toBe(3);
    });

    it("tracks engagement", () => {
      store.logProactiveMessage({
        senderId: "user1",
        channelId: "telegram",
        type: "intent",
        sourceId: "src1",
      });

      store.markEngaged("user1", "telegram");

      const rate = store.getEngagementRate("user1", "telegram");
      expect(rate).toBe(1.0);
    });

    it("returns 0 engagement rate with no history", () => {
      const rate = store.getEngagementRate("user1", "telegram");
      expect(rate).toBe(0);
    });
  });

  describe("cleanup", () => {
    it("purges expired intents", () => {
      store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "old",
        executeAt: Date.now() - 999_999_999,
      });

      const purged = store.purgeExpired(86_400_000);
      expect(purged).toBeGreaterThan(0);
      expect(store.listPendingIntents()).toHaveLength(0);
    });
  });
});
