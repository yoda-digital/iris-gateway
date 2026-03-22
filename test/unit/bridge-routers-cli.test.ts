import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { cliRouter } from "../../src/bridge/routers/cli.js";
import type { Logger } from "../../src/logging/logger.js";
import type { CliExecutor } from "../../src/cli/executor.js";
import type { CliToolRegistry } from "../../src/cli/registry.js";

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function makeExecutor(result: unknown = { ok: true, output: "done", exitCode: 0 }): CliExecutor {
  return { exec: vi.fn().mockResolvedValue(result) } as unknown as CliExecutor;
}

function makeRegistry(cmd = { binary: "mytool", args: ["run"] }): CliToolRegistry {
  return { buildCommand: vi.fn().mockReturnValue(cmd) } as unknown as CliToolRegistry;
}

function makeApp(opts: {
  cliExecutor?: CliExecutor | null;
  cliRegistry?: CliToolRegistry | null;
} = {}): Hono {
  const logger = makeLogger();
  const router = cliRouter({
    logger,
    cliExecutor: opts.cliExecutor !== undefined ? opts.cliExecutor : makeExecutor(),
    cliRegistry: opts.cliRegistry !== undefined ? opts.cliRegistry : makeRegistry(),
  });
  const app = new Hono();
  app.route("/", router);
  return app;
}

describe("cliRouter", () => {
  describe("503 — CLI tools not configured", () => {
    it("returns 503 when cliExecutor is null", async () => {
      const app = makeApp({ cliExecutor: null });
      const res = await app.request("/cli/mytool", {
        method: "POST",
        body: JSON.stringify({ action: "run" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/not configured/i);
    });

    it("returns 503 when cliRegistry is null", async () => {
      const app = makeApp({ cliRegistry: null });
      const res = await app.request("/cli/mytool", {
        method: "POST",
        body: JSON.stringify({ action: "run" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(503);
    });
  });

  describe("400 — validation error", () => {
    it("returns 400 when action is missing", async () => {
      const app = makeApp();
      const res = await app.request("/cli/mytool", {
        method: "POST",
        body: JSON.stringify({ foo: "bar" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/invalid request/i);
    });

    it("returns 400 when action is empty string", async () => {
      const app = makeApp();
      const res = await app.request("/cli/mytool", {
        method: "POST",
        body: JSON.stringify({ action: "" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("200 — successful execution", () => {
    it("returns exec result on success", async () => {
      const executor = makeExecutor({ ok: true, output: "hello", exitCode: 0 });
      const registry = makeRegistry({ binary: "cli-tool", args: ["--foo", "bar"] });
      const app = makeApp({ cliExecutor: executor, cliRegistry: registry });

      const res = await app.request("/cli/mytool", {
        method: "POST",
        body: JSON.stringify({ action: "run", extra: "value" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; output: string };
      expect(body.ok).toBe(true);
      expect(body.output).toBe("hello");
      expect(registry.buildCommand).toHaveBeenCalledWith("mytool", "run", { extra: "value" });
      expect(executor.exec).toHaveBeenCalledWith("cli-tool", ["--foo", "bar"]);
    });

    it("passes additional args to buildCommand", async () => {
      const registry = makeRegistry();
      const app = makeApp({ cliRegistry: registry });
      await app.request("/cli/sometool", {
        method: "POST",
        body: JSON.stringify({ action: "check", verbose: "true", count: "5" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(registry.buildCommand).toHaveBeenCalledWith("sometool", "check", { verbose: "true", count: "5" });
    });
  });

  describe("400 — executor throws", () => {
    it("returns 400 with error message when buildCommand throws", async () => {
      const registry = { buildCommand: vi.fn().mockImplementation(() => { throw new Error("unknown tool"); }) } as unknown as CliToolRegistry;
      const app = makeApp({ cliRegistry: registry });

      const res = await app.request("/cli/badtool", {
        method: "POST",
        body: JSON.stringify({ action: "run" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { ok: boolean; error: string; exitCode: number };
      expect(body.ok).toBe(false);
      expect(body.error).toBe("unknown tool");
      expect(body.exitCode).toBe(-1);
    });

    it("returns 400 when exec throws", async () => {
      const executor = { exec: vi.fn().mockRejectedValue(new Error("exec failed")) } as unknown as CliExecutor;
      const app = makeApp({ cliExecutor: executor });

      const res = await app.request("/cli/mytool", {
        method: "POST",
        body: JSON.stringify({ action: "run" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBe("exec failed");
    });

    it("handles non-Error throws with string conversion", async () => {
      const executor = { exec: vi.fn().mockRejectedValue("string error") } as unknown as CliExecutor;
      const app = makeApp({ cliExecutor: executor });

      const res = await app.request("/cli/mytool", {
        method: "POST",
        body: JSON.stringify({ action: "run" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("string error");
    });
  });
});
