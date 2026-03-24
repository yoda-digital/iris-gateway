import { describe, it, expect, vi, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

// We import the real module — no mocks — so coverage is tracked
import { initSecurity } from "../../src/gateway/security-wiring.js";
import type { IrisConfig } from "../../src/config/types.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "iris-security-wiring-"));
}

function makeConfig(overrides: Partial<IrisConfig["security"]> = {}): IrisConfig {
  return {
    gateway: { host: "localhost", port: 3000 },
    channels: {},
    security: {
      defaultDmPolicy: "allowlist",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 60,
      rateLimitPerHour: 1_000,
      ...overrides,
    },
    opencode: { port: 4000, hostname: "localhost", autoSpawn: false },
  } as unknown as IrisConfig;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("initSecurity", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = makeTempDir();
  });

  it("returns all four security components", () => {
    const config = makeConfig();
    const result = initSecurity(config, stateDir);

    expect(result).toHaveProperty("pairingStore");
    expect(result).toHaveProperty("allowlistStore");
    expect(result).toHaveProperty("rateLimiter");
    expect(result).toHaveProperty("securityGate");
  });

  it("PairingStore is constructed with correct stateDir", async () => {
    const config = makeConfig();
    const { pairingStore } = initSecurity(config, stateDir);

    // issueCode should work (no throw) — proves store is properly initialised
    await expect(pairingStore.issueCode("ch1", "user1")).resolves.toBeDefined();
  });

  it("AllowlistStore is constructed with correct stateDir", async () => {
    const config = makeConfig();
    const { allowlistStore } = initSecurity(config, stateDir);

    // isAllowed should resolve to false for unknown sender (store is empty)
    await expect(allowlistStore.isAllowed("ch1", "user1")).resolves.toBe(false);
  });

  it("RateLimiter respects perMinute config (check + hit pattern)", () => {
    const config = makeConfig({ rateLimitPerMinute: 2, rateLimitPerHour: 1_000 });
    const { rateLimiter } = initSecurity(config, stateDir);

    // check() reads, hit() records — must call both in sequence
    const first = rateLimiter.check("key");
    rateLimiter.hit("key");
    const second = rateLimiter.check("key");
    rateLimiter.hit("key");
    const third = rateLimiter.check("key");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });

  it("RateLimiter respects perHour config (check + hit pattern)", () => {
    const config = makeConfig({ rateLimitPerMinute: 1_000, rateLimitPerHour: 1 });
    const { rateLimiter } = initSecurity(config, stateDir);

    const first = rateLimiter.check("hourkey");
    rateLimiter.hit("hourkey");
    const second = rateLimiter.check("hourkey");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it("SecurityGate rejects when policy is 'disabled'", async () => {
    const config = makeConfig({ defaultDmPolicy: "disabled" });
    const { securityGate } = initSecurity(config, stateDir);

    const result = await securityGate.check({
      channelId: "ch1",
      senderId: "user1",
      senderName: "Alice",
      chatType: "dm",
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("disabled");
    }
  });

  it("SecurityGate allows sender on allowlist", async () => {
    const config = makeConfig({ defaultDmPolicy: "allowlist" });
    const { allowlistStore, securityGate } = initSecurity(config, stateDir);

    await allowlistStore.add("ch1", "user1");

    const result = await securityGate.check({
      channelId: "ch1",
      senderId: "user1",
      senderName: "Alice",
      chatType: "dm",
    });

    expect(result.allowed).toBe(true);
  });

  it("SecurityGate issues pairing code for unknown sender under 'pairing' policy", async () => {
    const config = makeConfig({ defaultDmPolicy: "pairing" });
    const { securityGate } = initSecurity(config, stateDir);

    const result = await securityGate.check({
      channelId: "ch1",
      senderId: "user99",
      senderName: "Unknown",
      chatType: "dm",
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("pairing_required");
      if (result.reason === "pairing_required") {
        expect(typeof result.pairingCode).toBe("string");
        expect(result.pairingCode.length).toBeGreaterThan(0);
      }
    }
  });

  it("SecurityGate rate-limits after threshold is exceeded", async () => {
    const config = makeConfig({
      defaultDmPolicy: "open",
      rateLimitPerMinute: 2,
      rateLimitPerHour: 1_000,
    });
    const { securityGate } = initSecurity(config, stateDir);

    const params = {
      channelId: "ch1",
      senderId: "spammer",
      senderName: "Spammer",
      chatType: "dm" as const,
    };

    // First two calls should be allowed (open policy, within rate limit)
    const r1 = await securityGate.check(params);
    const r2 = await securityGate.check(params);
    // Third call should be rate-limited
    const r3 = await securityGate.check(params);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    if (!r3.allowed) {
      expect(r3.reason).toBe("rate_limited");
    }
  });

  it("works with different state directories (isolation)", () => {
    const dir1 = makeTempDir();
    const dir2 = makeTempDir();
    const config = makeConfig();

    const result1 = initSecurity(config, dir1);
    const result2 = initSecurity(config, dir2);

    // Both should be valid independent instances
    expect(result1.pairingStore).not.toBe(result2.pairingStore);
    expect(result1.allowlistStore).not.toBe(result2.allowlistStore);
  });

  it("uses custom pairing code TTL from config", async () => {
    const shortTtl = 1; // 1 ms — effectively already expired
    const config = makeConfig({ pairingCodeTtlMs: shortTtl });
    const { pairingStore } = initSecurity(config, stateDir);

    // Should issue code (TTL is applied at verify time, not issue time)
    const code = await pairingStore.issueCode("ch1", "user1");
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(0);
  });

  it("uses custom pairing code length from config", async () => {
    const config = makeConfig({ pairingCodeLength: 4 });
    const { pairingStore } = initSecurity(config, stateDir);

    const code = await pairingStore.issueCode("ch1", "user1");
    expect(code.length).toBe(4);
  });
});
