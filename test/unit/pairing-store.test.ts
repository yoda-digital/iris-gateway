import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PairingStore } from "../../src/security/pairing-store.js";

describe("PairingStore", () => {
  let tempDir: string;
  let store: PairingStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-test-"));
    writeFileSync(join(tempDir, "pairing.json"), "[]");
    store = new PairingStore(tempDir, 3_600_000, 8);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("issues 8-char codes", async () => {
    const code = await store.issueCode("telegram", "user1");
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-Z2-9]+$/);
  });

  it("returns same code for same user", async () => {
    const code1 = await store.issueCode("telegram", "user1");
    const code2 = await store.issueCode("telegram", "user1");
    expect(code1).toBe(code2);
  });

  it("issues different codes for different users", async () => {
    const code1 = await store.issueCode("telegram", "user1");
    const code2 = await store.issueCode("telegram", "user2");
    expect(code1).not.toBe(code2);
  });

  it("approves a code", async () => {
    const code = await store.issueCode("telegram", "user1");
    const result = await store.approveCode(code);
    expect(result).toEqual({ channelId: "telegram", senderId: "user1" });
  });

  it("returns null for invalid code", async () => {
    const result = await store.approveCode("INVALID1");
    expect(result).toBeNull();
  });

  it("removes code after approval", async () => {
    const code = await store.issueCode("telegram", "user1");
    await store.approveCode(code);
    const result = await store.approveCode(code);
    expect(result).toBeNull();
  });

  it("revokes a code", async () => {
    const code = await store.issueCode("telegram", "user1");
    const revoked = await store.revokeCode(code);
    expect(revoked).toBe(true);
    const pending = await store.listPending();
    expect(pending).toHaveLength(0);
  });

  it("lists pending requests", async () => {
    await store.issueCode("telegram", "user1");
    await store.issueCode("discord", "user2");
    const pending = await store.listPending();
    expect(pending).toHaveLength(2);
  });

  it("handles case-insensitive approval", async () => {
    const code = await store.issueCode("telegram", "user1");
    const result = await store.approveCode(code.toLowerCase());
    // Our codes are uppercase, and we toUpperCase on approve
    expect(result).toEqual({ channelId: "telegram", senderId: "user1" });
  });

  it("prunes expired codes", async () => {
    const expiredStore = new PairingStore(tempDir, 1, 8); // 1ms TTL
    await expiredStore.issueCode("telegram", "user1");
    await new Promise((r) => setTimeout(r, 50));
    const pending = await expiredStore.listPending();
    expect(pending).toHaveLength(0);
  });
});
