import { describe, it, expect } from "vitest";
import type {
  Memory,
  MemoryType,
  MemorySource,
  UserProfile,
  AuditEntry,
  GovernanceLogEntry,
  VaultContext,
} from "../../src/vault/types.js";

describe("vault types", () => {
  it("Memory satisfies interface shape", () => {
    const m: Memory = {
      id: "m1",
      sessionId: "s1",
      channelId: "telegram",
      senderId: "u1",
      type: "fact",
      content: "User likes cats",
      source: "user_stated",
      confidence: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: null,
    };
    expect(m.type).toBe("fact");
    expect(m.source).toBe("user_stated");
  });

  it("UserProfile satisfies interface shape", () => {
    const p: UserProfile = {
      senderId: "u1",
      channelId: "telegram",
      name: "Nalyk",
      timezone: "Europe/Chisinau",
      language: "en",
      preferences: {},
      firstSeen: Date.now(),
      lastSeen: Date.now(),
    };
    expect(p.name).toBe("Nalyk");
  });

  it("AuditEntry satisfies interface shape", () => {
    const a: AuditEntry = {
      id: 1,
      timestamp: Date.now(),
      sessionId: "s1",
      tool: "send_message",
      args: "{}",
      result: "{}",
      durationMs: 42,
    };
    expect(a.tool).toBe("send_message");
  });

  it("VaultContext satisfies interface shape", () => {
    const ctx: VaultContext = {
      profile: null,
      memories: [],
    };
    expect(ctx.memories).toEqual([]);
  });
});
