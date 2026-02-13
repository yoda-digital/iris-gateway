import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";

describe("VaultStore", () => {
  let dir: string;
  let db: VaultDB;
  let store: VaultStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-vault-"));
    db = new VaultDB(dir);
    store = new VaultStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("memories", () => {
    it("stores and retrieves a memory", () => {
      const id = store.addMemory({
        sessionId: "s1",
        channelId: "telegram",
        senderId: "u1",
        type: "fact",
        content: "Likes cats",
        source: "user_stated",
      });

      const mem = store.getMemory(id);
      expect(mem).not.toBeNull();
      expect(mem!.content).toBe("Likes cats");
      expect(mem!.type).toBe("fact");
    });

    it("lists memories by sender", () => {
      store.addMemory({
        sessionId: "s1",
        channelId: "tg",
        senderId: "u1",
        type: "fact",
        content: "A",
        source: "user_stated",
      });
      store.addMemory({
        sessionId: "s2",
        channelId: "tg",
        senderId: "u2",
        type: "fact",
        content: "B",
        source: "user_stated",
      });

      const list = store.listMemories({ senderId: "u1" });
      expect(list).toHaveLength(1);
      expect(list[0].content).toBe("A");
    });

    it("deletes a memory", () => {
      const id = store.addMemory({
        sessionId: "s1",
        channelId: "tg",
        senderId: "u1",
        type: "fact",
        content: "X",
        source: "user_stated",
      });
      expect(store.deleteMemory(id)).toBe(true);
      expect(store.getMemory(id)).toBeNull();
    });

    it("removes expired memories", () => {
      store.addMemory({
        sessionId: "s1",
        channelId: "tg",
        senderId: "u1",
        type: "fact",
        content: "expired",
        source: "system",
        expiresAt: Date.now() - 1000,
      });
      store.addMemory({
        sessionId: "s1",
        channelId: "tg",
        senderId: "u1",
        type: "fact",
        content: "valid",
        source: "system",
      });

      store.purgeExpired();
      const all = store.listMemories({ senderId: "u1" });
      expect(all).toHaveLength(1);
      expect(all[0].content).toBe("valid");
    });
  });

  describe("profiles", () => {
    it("upserts and retrieves a profile", () => {
      store.upsertProfile({
        senderId: "u1",
        channelId: "telegram",
        name: "Nalyk",
        timezone: "UTC+2",
        language: "en",
      });

      const profile = store.getProfile("u1", "telegram");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("Nalyk");
    });

    it("updates existing profile on second upsert", () => {
      store.upsertProfile({ senderId: "u1", channelId: "tg", name: "Old" });
      store.upsertProfile({ senderId: "u1", channelId: "tg", name: "New" });
      const profile = store.getProfile("u1", "tg");
      expect(profile!.name).toBe("New");
    });
  });

  describe("audit log", () => {
    it("logs and retrieves audit entries", () => {
      store.logAudit({
        sessionId: "s1",
        tool: "send_message",
        args: '{"to":"chat1"}',
        result: '{"messageId":"m1"}',
        durationMs: 50,
      });

      const entries = store.listAuditLog({ limit: 10 });
      expect(entries).toHaveLength(1);
      expect(entries[0].tool).toBe("send_message");
    });
  });

  describe("governance log", () => {
    it("logs governance decisions", () => {
      store.logGovernance({
        sessionId: "s1",
        tool: "send_message",
        ruleId: "no-spam",
        action: "blocked",
        reason: "Rate limited",
      });

      const entries = store.listGovernanceLog({ limit: 10 });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("blocked");
    });
  });
});
