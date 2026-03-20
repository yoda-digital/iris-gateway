import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { syncModelsToOpenCode } from "../../src/config/model-sync.js";
import type { IrisConfig } from "../../src/config/types.js";
import type { Logger } from "../../src/logging/logger.js";

// Minimal logger stub
const makeLogger = (): Logger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }) as unknown as Logger;

// Build minimal IrisConfig with required fields only
function makeConfig(overrides: Partial<IrisConfig> = {}): IrisConfig {
  return {
    gateway: { port: 19876, hostname: "127.0.0.1" },
    channels: {},
    security: { defaultDmPolicy: "open" } as IrisConfig["security"],
    opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false, projectDir: "" },
    ...overrides,
  } as IrisConfig;
}

describe("syncModelsToOpenCode", () => {
  let tmpDir: string;
  let ocPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "iris-model-sync-"));
    const opencodeDir = join(tmpDir, ".opencode");
    mkdirSync(opencodeDir, { recursive: true });
    ocPath = join(opencodeDir, "opencode.json");
    // Write a baseline opencode.json
    writeFileSync(ocPath, JSON.stringify({ model: "old-model", small_model: "old-small" }, null, 2));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when config.models is absent", async () => {
    const config = makeConfig({ opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false, projectDir: tmpDir } });
    const logger = makeLogger();
    const result = await syncModelsToOpenCode(config, config.opencode, logger);
    expect(result).toBe(false);
  });

  it("returns false when config.models is empty object", async () => {
    const config = makeConfig({
      models: {},
      opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false, projectDir: tmpDir },
    });
    const logger = makeLogger();
    const result = await syncModelsToOpenCode(config, config.opencode, logger);
    expect(result).toBe(false);
  });

  it("syncs primary and small models into opencode.json", async () => {
    const config = makeConfig({
      models: { primary: "anthropic/claude-sonnet-4-5", small: "anthropic/claude-haiku-3-5" },
      opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false, projectDir: tmpDir },
    });
    const logger = makeLogger();
    const result = await syncModelsToOpenCode(config, config.opencode, logger);
    expect(result).toBe(true);
    const written = JSON.parse(readFileSync(ocPath, "utf-8"));
    expect(written.model).toBe("anthropic/claude-sonnet-4-5");
    expect(written.small_model).toBe("anthropic/claude-haiku-3-5");
  });

  it("returns false when models already match opencode.json", async () => {
    writeFileSync(
      ocPath,
      JSON.stringify({ model: "anthropic/claude-sonnet-4-5", small_model: "anthropic/claude-haiku-3-5" }, null, 2),
    );
    const config = makeConfig({
      models: { primary: "anthropic/claude-sonnet-4-5", small: "anthropic/claude-haiku-3-5" },
      opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false, projectDir: tmpDir },
    });
    const logger = makeLogger();
    const result = await syncModelsToOpenCode(config, config.opencode, logger);
    expect(result).toBe(false);
  });

  it("auto-registers openrouter models without OPENROUTER_API_KEY using safe defaults", async () => {
    // Ensure API key is absent so fallback defaults are used
    delete process.env["OPENROUTER_API_KEY"];
    const config = makeConfig({
      models: { primary: "openrouter/anthropic/claude-sonnet-4-5" },
      opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false, projectDir: tmpDir },
    });
    const logger = makeLogger();
    const result = await syncModelsToOpenCode(config, config.opencode, logger);
    expect(result).toBe(true);
    const written = JSON.parse(readFileSync(ocPath, "utf-8"));
    const registeredModel = written.provider?.openrouter?.models?.["anthropic/claude-sonnet-4-5"];
    expect(registeredModel).toBeDefined();
    expect(registeredModel.tool_call).toBe(true);
    expect(registeredModel.limit.context).toBe(131072);
    expect(registeredModel.limit.output).toBe(16384);
  });

  it("skips non-openrouter models in auto-registration", async () => {
    const config = makeConfig({
      models: { primary: "anthropic/claude-opus-4-5" },
      opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false, projectDir: tmpDir },
    });
    const logger = makeLogger();
    await syncModelsToOpenCode(config, config.opencode, logger);
    const written = JSON.parse(readFileSync(ocPath, "utf-8"));
    // No openrouter provider section should be created for non-openrouter model
    expect(written.provider?.openrouter?.models).toBeUndefined();
  });

  it("syncs primary model into agent frontmatter when model: key present", async () => {
    const agentDir = join(tmpDir, ".opencode", "agent");
    mkdirSync(agentDir, { recursive: true });
    const agentMd = join(agentDir, "default.md");
    writeFileSync(agentMd, "---\nmodel: old-model\n---\nSystem prompt here.");
    const config = makeConfig({
      models: { primary: "anthropic/claude-sonnet-4-5" },
      opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false, projectDir: tmpDir },
    });
    const logger = makeLogger();
    await syncModelsToOpenCode(config, config.opencode, logger);
    const content = readFileSync(agentMd, "utf-8");
    expect(content).toContain("model: anthropic/claude-sonnet-4-5");
  });

  it("returns false when opencode.json is missing or unreadable", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "iris-model-sync-empty-"));
    const config = makeConfig({
      models: { primary: "anthropic/claude-sonnet-4-5" },
      opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false, projectDir: emptyDir },
    });
    const logger = makeLogger();
    const result = await syncModelsToOpenCode(config, config.opencode, logger);
    expect(result).toBe(false);
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
