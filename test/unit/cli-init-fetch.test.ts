import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock("@clack/prompts", () => {
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(),
    cancel: vi.fn(),
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), message: vi.fn() },
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    isCancel: vi.fn((v: unknown) => v === null),
    multiselect: vi.fn(),
    text: vi.fn(),
    confirm: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 1, stdout: "" })), // detectOpenCode → null by default
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getClack() {
  const mod = await import("@clack/prompts");
  return mod;
}

// ─── fetchWithTimeout null-return path tests ──────────────────────────────────

describe("InitCommand: fetchWithTimeout null-return path", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-init-timeout-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("saves telegram token even when fetch rejects (null-return path — saved anyway)", async () => {
    // Simulate fetchWithTimeout returning null (network error / AbortError)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("AbortError")));

    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;

    p.multiselect.mockResolvedValueOnce(["telegram"]);
    p.text.mockResolvedValueOnce("123:validformat");
    p.text.mockResolvedValueOnce("openrouter/arcee-ai/arcee-spotlight:free"); // model (text input)
    p.confirm.mockResolvedValueOnce(false);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    // Wizard proceeds and saves token despite fetch failure (saved anyway)
    expect(exitCode).toBe(0);
    expect(vi.mocked(global.fetch)).toHaveBeenCalled();
    expect(existsSync(join(tempDir, "iris.config.json"))).toBe(true);
    const config = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    expect(config.channels.telegram.token).toBe("${env:TELEGRAM_BOT_TOKEN}");
  });

  it("saves slack tokens even when fetch rejects (validateSlackAppToken null-return path — saved anyway)", async () => {
    // Simulate fetchWithTimeout returning null inside validateSlackAppToken (lines 60-75)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("AbortError")));

    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;

    p.multiselect.mockResolvedValueOnce(["slack"]);
    p.text.mockResolvedValueOnce("xapp-1-invalid"); // appToken
    p.text.mockResolvedValueOnce("xoxb-invalid");   // botToken
    p.text.mockResolvedValueOnce("openrouter/arcee-ai/arcee-spotlight:free"); // model (text input)
    p.confirm.mockResolvedValueOnce(false);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    // Wizard proceeds and saves tokens despite fetch failure (saved anyway)
    expect(exitCode).toBe(0);
    expect(vi.mocked(global.fetch)).toHaveBeenCalled();
    expect(existsSync(join(tempDir, "iris.config.json"))).toBe(true);
    const config = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    expect(config.channels.slack.appToken).toBe("${env:SLACK_APP_TOKEN}");
    expect(config.channels.slack.botToken).toBe("${env:SLACK_BOT_TOKEN}");
  });

  it("saves discord token even when fetch rejects (null-return path — saved anyway)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("AbortError")));

    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;

    p.multiselect.mockResolvedValueOnce(["discord"]);
    p.text.mockResolvedValueOnce("invalid-discord-token");
    p.text.mockResolvedValueOnce("openrouter/arcee-ai/arcee-spotlight:free"); // model (text input)
    p.confirm.mockResolvedValueOnce(false);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    // Wizard continues and saves despite fetch failure
    expect(exitCode).toBe(0);
    expect(vi.mocked(global.fetch)).toHaveBeenCalled();
    expect(existsSync(join(tempDir, "iris.config.json"))).toBe(true);
    const config = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    expect(config.channels.discord.token).toBe("${env:DISCORD_BOT_TOKEN}");
  });
});
