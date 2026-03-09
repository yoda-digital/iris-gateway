/**
 * Unit tests for src/bridge/routers/vault.ts
 * Uses Hono app.request() — no live server, no ports.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { vaultRouter } from "../../src/bridge/routers/vault.js";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";

async function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /vault/extract", () => {
  let dir: string;
  let db: VaultDB;
  let store: VaultStore;
  let app: Hono;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-vault-router-"));
    db = new VaultDB(dir);
    store = new VaultStore(db);
    app = new Hono();
    app.route("/", vaultRouter({ vaultStore: store }));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores facts and returns their IDs", async () => {
    const res = await post(app, "/vault/extract", {
      sessionId: "sess-1",
      channelId: "telegram",
      senderId: "user-1",
      facts: [
        { type: "fact", content: "User likes cats" },
        { type: "preference", content: "Prefers dark mode" },
      ],
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ids: string[] };
    expect(json.ids).toHaveLength(2);
    expect(typeof json.ids[0]).toBe("string");
    expect(typeof json.ids[1]).toBe("string");

    // Verify they were actually persisted
    const mem0 = store.getMemory(json.ids[0]);
    expect(mem0).not.toBeNull();
    expect(mem0!.content).toBe("User likes cats");
    expect(mem0!.source).toBe("extracted");

    const mem1 = store.getMemory(json.ids[1]);
    expect(mem1).not.toBeNull();
    expect(mem1!.content).toBe("Prefers dark mode");
  });

  it("returns 503 when vaultStore is not configured", async () => {
    const bareApp = new Hono();
    bareApp.route("/", vaultRouter({ vaultStore: null }));

    const res = await post(bareApp, "/vault/extract", {
      facts: [{ type: "fact", content: "Something" }],
    });

    expect(res.status).toBe(503);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("Vault not configured");
  });

  it("returns empty ids array for empty facts array", async () => {
    const res = await post(app, "/vault/extract", {
      sessionId: "sess-2",
      facts: [],
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ids: string[] };
    expect(json.ids).toEqual([]);
  });
});
