import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolServer } from "../../src/bridge/tool-server.js";
import { ChannelRegistry } from "../../src/channels/registry.js";

describe("tool scaffold — not-implemented guard", () => {
  let server: ToolServer;
  let port: number;
  let dir: string;

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  } as any;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "iris-tool-scaffold-test-"));
    const origCwd = process.cwd;
    process.cwd = () => dir;
    port = 19800 + Math.floor(Math.random() * 100);
    server = new ToolServer({ registry: new ChannelRegistry(), logger, port });
    process.cwd = origCwd;
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("generated tool file throws not-implemented error instead of silent no-op", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/tools/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "my-tool",
        description: "A test tool",
        args: [{ name: "input", type: "string", description: "test input" }],
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json() as { ok: boolean; path: string };
    expect(body.ok).toBe(true);

    const generatedContent = readFileSync(body.path, "utf-8");

    // Must NOT contain the silent stub
    expect(generatedContent).not.toContain("JSON.stringify({ ok: true, args })");
    expect(generatedContent).not.toContain("// TODO:");

    // Must contain the explicit not-implemented throw
    expect(generatedContent).toContain("throw new Error");
    expect(generatedContent).toContain("was scaffolded but not implemented");
  });
});
