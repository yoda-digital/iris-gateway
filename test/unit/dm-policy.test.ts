import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SecurityGate } from "../../src/security/dm-policy.js";
import { PairingStore } from "../../src/security/pairing-store.js";
import { AllowlistStore } from "../../src/security/allowlist-store.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";
import type { SecurityConfig } from "../../src/config/types.js";

function makeConfig(
  overrides: Partial<SecurityConfig> = {},
): SecurityConfig {
  return {
    defaultDmPolicy: "open",
    pairingCodeTtlMs: 3_600_000,
    pairingCodeLength: 8,
    rateLimitPerMinute: 30,
    rateLimitPerHour: 300,
    ...overrides,
  };
}

describe("SecurityGate", () => {
  let tempDir: string;
  let pairingStore: PairingStore;
  let allowlistStore: AllowlistStore;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-test-"));
    writeFileSync(join(tempDir, "pairing.json"), "[]");
    writeFileSync(join(tempDir, "allowlist.json"), "[]");
    pairingStore = new PairingStore(tempDir);
    allowlistStore = new AllowlistStore(tempDir);
    rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows all in open mode", async () => {
    const gate = new SecurityGate(
      pairingStore,
      allowlistStore,
      rateLimiter,
      makeConfig({ defaultDmPolicy: "open" }),
    );
    const result = await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "User",
      chatType: "dm",
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks all in disabled mode", async () => {
    const gate = new SecurityGate(
      pairingStore,
      allowlistStore,
      rateLimiter,
      makeConfig({ defaultDmPolicy: "disabled" }),
    );
    const result = await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "User",
      chatType: "dm",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("disabled");
  });

  it("blocks non-allowed in allowlist mode", async () => {
    const gate = new SecurityGate(
      pairingStore,
      allowlistStore,
      rateLimiter,
      makeConfig({ defaultDmPolicy: "allowlist" }),
    );
    const result = await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "User",
      chatType: "dm",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("not_allowed");
  });

  it("allows allowlisted users in allowlist mode", async () => {
    await allowlistStore.add("telegram", "user1");
    const gate = new SecurityGate(
      pairingStore,
      allowlistStore,
      rateLimiter,
      makeConfig({ defaultDmPolicy: "allowlist" }),
    );
    const result = await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "User",
      chatType: "dm",
    });
    expect(result.allowed).toBe(true);
  });

  it("issues pairing code in pairing mode", async () => {
    const gate = new SecurityGate(
      pairingStore,
      allowlistStore,
      rateLimiter,
      makeConfig({ defaultDmPolicy: "pairing" }),
    );
    const result = await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "Test User",
      chatType: "dm",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("pairing_required");
      if (result.reason === "pairing_required") {
        expect(result.pairingCode).toHaveLength(8);
        expect(result.message).toContain("Test User");
      }
    }
  });

  it("allows already-paired users in pairing mode", async () => {
    await allowlistStore.add("telegram", "user1");
    const gate = new SecurityGate(
      pairingStore,
      allowlistStore,
      rateLimiter,
      makeConfig({ defaultDmPolicy: "pairing" }),
    );
    const result = await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "User",
      chatType: "dm",
    });
    expect(result.allowed).toBe(true);
  });

  it("respects per-channel policy override", async () => {
    const gate = new SecurityGate(
      pairingStore,
      allowlistStore,
      rateLimiter,
      makeConfig({ defaultDmPolicy: "open" }),
    );
    const result = await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "User",
      chatType: "dm",
      channelDmPolicy: "disabled",
    });
    expect(result.allowed).toBe(false);
  });

  it("rate limits users", async () => {
    const tightLimiter = new RateLimiter({ perMinute: 2, perHour: 100 });
    const gate = new SecurityGate(
      pairingStore,
      allowlistStore,
      tightLimiter,
      makeConfig({ defaultDmPolicy: "open" }),
    );

    // First two should pass
    await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "User",
      chatType: "dm",
    });
    await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "User",
      chatType: "dm",
    });

    // Third should be rate limited
    const result = await gate.check({
      channelId: "telegram",
      senderId: "user1",
      senderName: "User",
      chatType: "dm",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("rate_limited");
  });
});
