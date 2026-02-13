import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AllowlistStore } from "../../src/security/allowlist-store.js";

describe("AllowlistStore", () => {
  let tempDir: string;
  let store: AllowlistStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-test-"));
    // Create the allowlist.json file so locking works
    writeFileSync(join(tempDir, "allowlist.json"), "[]");
    store = new AllowlistStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("initially allows no one", async () => {
    expect(await store.isAllowed("telegram", "user1")).toBe(false);
  });

  it("adds and checks", async () => {
    await store.add("telegram", "user1");
    expect(await store.isAllowed("telegram", "user1")).toBe(true);
    expect(await store.isAllowed("telegram", "user2")).toBe(false);
  });

  it("removes entries", async () => {
    await store.add("telegram", "user1");
    const removed = await store.remove("telegram", "user1");
    expect(removed).toBe(true);
    expect(await store.isAllowed("telegram", "user1")).toBe(false);
  });

  it("returns false when removing non-existent", async () => {
    const removed = await store.remove("telegram", "nobody");
    expect(removed).toBe(false);
  });

  it("lists entries by channel", async () => {
    await store.add("telegram", "user1");
    await store.add("telegram", "user2");
    await store.add("discord", "user3");
    const tgList = await store.list("telegram");
    expect(tgList).toHaveLength(2);
    const dcList = await store.list("discord");
    expect(dcList).toHaveLength(1);
  });

  it("does not duplicate entries", async () => {
    await store.add("telegram", "user1");
    await store.add("telegram", "user1");
    const list = await store.list("telegram");
    expect(list).toHaveLength(1);
  });

  it("persists across instances", async () => {
    await store.add("telegram", "user1");
    const store2 = new AllowlistStore(tempDir);
    expect(await store2.isAllowed("telegram", "user1")).toBe(true);
  });
});
