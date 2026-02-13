import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginLoader } from "../../src/plugins/loader.js";

describe("PluginLoader", () => {
  const testDir = join(tmpdir(), "iris-plugin-test-" + Date.now());

  it("loads a plugin from a TypeScript file", async () => {
    const pluginDir = join(testDir, "echo");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "index.ts"), `
      export default {
        id: "echo",
        name: "Echo Plugin",
        register(api) {
          api.registerTool("echo", {
            description: "Echo back input",
            args: {},
            async execute(args) { return { echo: true }; },
          });
        },
      };
    `);

    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => logger,
    } as any;

    const registry = await new PluginLoader(logger).loadAll(
      { plugins: [pluginDir] } as any,
      testDir,
    );

    expect(registry.tools.has("echo")).toBe(true);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty registry when no plugins configured", async () => {
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => logger,
    } as any;

    const registry = await new PluginLoader(logger).loadAll({} as any, join(tmpdir(), "iris-noplugins-" + Date.now()));
    expect(registry.tools.size).toBe(0);
  });
});
