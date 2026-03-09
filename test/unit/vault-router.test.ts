/**
 * Unit tests for src/bridge/routers/vault.ts
 * Uses Hono app.request() — no live server, no ports.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { vaultRouter } from "../../src/bridge/routers/vault.js";

async function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /vault/extract", () => {
  const app = new Hono();
  app.route("/", vaultRouter({}));

  it("extracts non-empty context lines as insight facts", async () => {
    const res = await post(app, "/vault/extract", {
      sessionID: "sess-1",
      context: ["User likes cats", "Prefers dark mode", "", "  "],
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { facts: Array<{ content: string; type: string }> };
    expect(json.facts).toHaveLength(2);
    expect(json.facts[0]).toEqual({ content: "User likes cats", type: "insight" });
    expect(json.facts[1]).toEqual({ content: "Prefers dark mode", type: "insight" });
  });

  it("returns empty facts array for empty context", async () => {
    const res = await post(app, "/vault/extract", {
      sessionID: "sess-2",
      context: [],
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { facts: unknown[] };
    expect(json.facts).toEqual([]);
  });

  it("returns empty facts when context is missing or not an array", async () => {
    const res = await post(app, "/vault/extract", {
      sessionID: "sess-3",
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { facts: unknown[] };
    expect(json.facts).toEqual([]);
  });
});
