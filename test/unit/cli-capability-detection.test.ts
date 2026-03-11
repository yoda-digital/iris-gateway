import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliExecutor } from "../../src/cli/executor.js";
import { CliToolRegistry } from "../../src/cli/registry.js";
import type { Logger } from "../../src/logging/logger.js";

const mockLogger: Logger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => mockLogger),
} as unknown as Logger;

const TOOLS_CONFIG = {
  gog: {
    binary: "gog",
    description: "Google Workspace CLI",
    actions: { "gmail.list": { subcommand: ["gmail", "list"] } },
    healthCheck: { command: ["gog", "auth", "status", "--json"], successExitCode: 0 },
  },
  himalaya: {
    binary: "himalaya",
    description: "Email CLI",
    actions: { list: { subcommand: ["envelope", "list"] } },
  },
};

describe("CliToolRegistry — removeTools", () => {
  it("removes specified tools from the registry", () => {
    const registry = new CliToolRegistry(TOOLS_CONFIG);
    expect(registry.listTools()).toContain("gog");
    registry.removeTools(["gog"]);
    expect(registry.listTools()).not.toContain("gog");
    expect(registry.listTools()).toContain("himalaya");
  });

  it("manifest reflects removed tools", () => {
    const registry = new CliToolRegistry(TOOLS_CONFIG);
    registry.removeTools(["gog"]);
    const manifest = registry.getManifest();
    expect(manifest).not.toHaveProperty("gog");
    expect(manifest).toHaveProperty("himalaya");
  });

  it("is safe to remove non-existent tool", () => {
    const registry = new CliToolRegistry(TOOLS_CONFIG);
    expect(() => registry.removeTools(["nonexistent"])).not.toThrow();
  });
});

describe("CliExecutor — probe", () => {
  let executor: CliExecutor;

  beforeEach(() => {
    executor = new CliExecutor({
      allowedBinaries: ["gog", "himalaya", "which"],
      timeout: 5000,
      logger: mockLogger,
    });
  });

  it("returns available=false when binary is not in PATH", async () => {
    // Use a binary that definitely doesn't exist
    const result = await executor.probe("__nonexistent_binary_xyz__");
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it("returns available=true for binary in PATH without healthCheck", async () => {
    // 'node' is always available in test env
    const result = await executor.probe("node");
    expect(result.available).toBe(true);
  });

  it("returns available=true when healthCheck exits with successExitCode", async () => {
    const result = await executor.probe("node", {
      command: ["node", "--version"],
      successExitCode: 0,
    });
    expect(result.available).toBe(true);
  });

  it("returns available=false when healthCheck exits with wrong code", async () => {
    const result = await executor.probe("node", {
      command: ["node", "-e", "process.exit(1)"],
      successExitCode: 0,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/health check/);
  });
});

describe("CLI capability detection — integration", () => {
  it("probing multiple tools filters unavailable ones", async () => {
    const registry = new CliToolRegistry(TOOLS_CONFIG);
    const executor = new CliExecutor({
      allowedBinaries: ["gog", "himalaya", "node"],
      timeout: 5000,
      logger: mockLogger,
    });

    const results = await Promise.all(
      registry.listTools().map(async (toolName) => {
        const def = registry.getToolDef(toolName)!;
        const result = await executor.probe(def.binary, def.healthCheck);
        return { toolName, ...result };
      })
    );

    const unavailable = results.filter((r) => !r.available);
    registry.removeTools(unavailable.map((r) => r.toolName));

    // All remaining tools in manifest should be available
    const manifest = registry.getManifest();
    for (const toolName of Object.keys(manifest)) {
      const match = results.find((r) => r.toolName === toolName);
      expect(match?.available).toBe(true);
    }
  });
});
