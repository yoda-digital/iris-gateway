import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";

describe("VaultDB", () => {
  let dir: string;
  let db: VaultDB;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-vault-"));
    db = new VaultDB(dir);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates database file on open", () => {
    expect(db.isOpen()).toBe(true);
  });

  it("creates memories table", () => {
    const tables = db
      .raw()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'",
      )
      .get() as { name: string } | undefined;
    expect(tables?.name).toBe("memories");
  });

  it("creates profiles table", () => {
    const tables = db
      .raw()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'",
      )
      .get() as { name: string } | undefined;
    expect(tables?.name).toBe("profiles");
  });

  it("creates audit_log table", () => {
    const tables = db
      .raw()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'",
      )
      .get() as { name: string } | undefined;
    expect(tables?.name).toBe("audit_log");
  });

  it("creates governance_log table", () => {
    const tables = db
      .raw()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='governance_log'",
      )
      .get() as { name: string } | undefined;
    expect(tables?.name).toBe("governance_log");
  });

  it("creates FTS5 virtual table for memories", () => {
    const tables = db
      .raw()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'",
      )
      .get() as { name: string } | undefined;
    expect(tables?.name).toBe("memories_fts");
  });
});
