import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";
import { VaultSearch } from "../../src/vault/search.js";

describe("VaultSearch", () => {
  let dir: string;
  let db: VaultDB;
  let store: VaultStore;
  let search: VaultSearch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-vault-"));
    db = new VaultDB(dir);
    store = new VaultStore(db);
    search = new VaultSearch(db);

    store.addMemory({
      sessionId: "s1",
      senderId: "u1",
      type: "fact",
      content: "User loves programming in TypeScript",
      source: "user_stated",
    });
    store.addMemory({
      sessionId: "s1",
      senderId: "u1",
      type: "preference",
      content: "Prefers dark mode interfaces",
      source: "user_stated",
    });
    store.addMemory({
      sessionId: "s2",
      senderId: "u2",
      type: "fact",
      content: "User lives in Moldova",
      source: "extracted",
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds memories matching query", () => {
    const results = search.search("TypeScript programming");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("TypeScript");
  });

  it("filters by senderId", () => {
    const results = search.search("", { senderId: "u2" });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("Moldova");
  });

  it("filters by type", () => {
    const results = search.search("", {
      senderId: "u1",
      type: "preference",
    });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("dark mode");
  });

  it("returns empty array for no matches", () => {
    const results = search.search("quantum physics black holes");
    expect(results).toHaveLength(0);
  });
});
