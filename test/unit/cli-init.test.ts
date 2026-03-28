import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Cancel sentinel ──────────────────────────────────────────────────────────
// We use `null` as our cancel sentinel because isCancel will check for it.
const CANCEL_SENTINEL = null;

// ─── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock("@clack/prompts", () => {
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(),
    cancel: vi.fn(),
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

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function getClack() {
  return await import("@clack/prompts");
}

async function getChildProcess() {
  return await import("node:child_process");
}

/** Build a set of prompt mocks for the "only telegram, no opencode" happy path */
async function setupHappyPathMocks(telegramToken = "123:abc", model = "openrouter/arcee-ai/arcee-spotlight:free") {
  const clack = await getClack();
  const p = clack as Record<string, ReturnType<typeof vi.fn>>;

  p.multiselect.mockResolvedValueOnce(["telegram"]);
  p.text.mockResolvedValueOnce(telegramToken); // telegram token
  p.text.mockResolvedValueOnce(model);         // model identifier (text input — no hardcoded options)
  p.confirm.mockResolvedValueOnce(false);      // skip opencode install
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InitCommand: happy path", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-init-test-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    // Mock fetch (token validation)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes iris.config.json on successful completion", async () => {
    await setupHappyPathMocks();

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    expect(exitCode).toBe(0);
    expect(existsSync(join(tempDir, "iris.config.json"))).toBe(true);
  });

  it("returns exit code 0 on success", async () => {
    await setupHappyPathMocks();

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    expect(exitCode).toBe(0);
  });

  it("writes .env file when a channel token is provided", async () => {
    await setupHappyPathMocks("987:TOKEN");

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const envPath = join(tempDir, ".env");
    expect(existsSync(envPath)).toBe(true);
    const envContent = readFileSync(envPath, "utf-8");
    expect(envContent).toContain("TELEGRAM_BOT_TOKEN=987:TOKEN");
  });

  it("does NOT write .env when no channel requires a token (whatsapp only)", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;

    p.multiselect.mockResolvedValueOnce(["whatsapp"]);
    p.text.mockResolvedValueOnce("openrouter/arcee-ai/arcee-spotlight:free"); // model (text input)
    p.confirm.mockResolvedValueOnce(false);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    expect(existsSync(join(tempDir, ".env"))).toBe(false);
  });
});

describe("InitCommand: existing config detection", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-init-existing-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("overwrites existing iris.config.json without error", async () => {
    // Write an existing config
    writeFileSync(join(tempDir, "iris.config.json"), JSON.stringify({ existing: true }));

    await setupHappyPathMocks();

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    expect(exitCode).toBe(0);
    const written = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    expect(written).not.toHaveProperty("existing");
    expect(written).toHaveProperty("channels");
  });

  it("merges base config from iris.config.example.json when present", async () => {
    const example = {
      gateway: { port: 9999 },
      models: { primary: "old-model" },
    };
    writeFileSync(join(tempDir, "iris.config.example.json"), JSON.stringify(example));

    await setupHappyPathMocks("tok:en", "openrouter/meta-llama/llama-3.3-70b-instruct:free");

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const written = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    // gateway from example should be preserved
    expect(written.gateway).toEqual({ port: 9999 });
    // model should be overridden
    expect(written.models.primary).toBe("openrouter/meta-llama/llama-3.3-70b-instruct:free");
  });
});

describe("InitCommand: EACCES error handling", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-init-eacces-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows sudo hint when execSync throws EACCES", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;
    const spinnerStop = vi.fn();
    p.spinner.mockReturnValue({ start: vi.fn(), stop: spinnerStop });

    p.multiselect.mockResolvedValueOnce(["whatsapp"]);
    p.text.mockResolvedValueOnce("openrouter/arcee-ai/arcee-spotlight:free"); // model (text input)
    p.confirm.mockResolvedValueOnce(true); // want to install opencode

    const cp = await getChildProcess();
    (cp.execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const stopCalls = spinnerStop.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(stopCalls.some((s) => s.includes("sudo npm i -g opencode-ai"))).toBe(true);
  });

  it("shows generic hint when execSync throws non-EACCES error", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;
    const spinnerStop = vi.fn();
    p.spinner.mockReturnValue({ start: vi.fn(), stop: spinnerStop });

    p.multiselect.mockResolvedValueOnce(["whatsapp"]);
    p.text.mockResolvedValueOnce("openrouter/arcee-ai/arcee-spotlight:free"); // model (text input)
    p.confirm.mockResolvedValueOnce(true);

    const cp = await getChildProcess();
    (cp.execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("network timeout");
    });

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const stopCalls = spinnerStop.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(stopCalls.some((s) => s.includes("npm i -g opencode-ai") && !s.includes("sudo"))).toBe(true);
  });

  it("still returns exit code 0 even when opencode install fails", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;
    p.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });

    p.multiselect.mockResolvedValueOnce(["whatsapp"]);
    p.text.mockResolvedValueOnce("openrouter/arcee-ai/arcee-spotlight:free"); // model (text input)
    p.confirm.mockResolvedValueOnce(true);

    const cp = await getChildProcess();
    (cp.execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    expect(exitCode).toBe(0);
  });
});

describe("InitCommand: model preset defaults", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-init-model-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("sets models.primary from selected preset", async () => {
    await setupHappyPathMocks("tok:en", "openrouter/meta-llama/llama-3.3-70b-instruct:free");

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const config = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    expect(config.models.primary).toBe("openrouter/meta-llama/llama-3.3-70b-instruct:free");
  });

  it("sets models.small equal to models.primary", async () => {
    await setupHappyPathMocks("tok:en", "openrouter/mistralai/mistral-7b-instruct:free");

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const config = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    expect(config.models.small).toBe(config.models.primary);
  });

  it("uses custom model when __custom__ is chosen", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;

    p.multiselect.mockResolvedValueOnce(["whatsapp"]);
    // No __custom__ option anymore — user types model directly via p.text
    p.text.mockResolvedValueOnce("openrouter/my-org/my-model:free"); // model identifier
    p.confirm.mockResolvedValueOnce(false);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const config = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    expect(config.models.primary).toBe("openrouter/my-org/my-model:free");
  });
});

describe("InitCommand: model prefix handling", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-init-prefix-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("prompts for OpenAI API key when model starts with openai/", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;

    p.multiselect.mockResolvedValueOnce(["whatsapp"]);
    p.text.mockResolvedValueOnce("openai/gpt-4.1-mini"); // model
    p.text.mockResolvedValueOnce("sk-test-openai"); // api key
    p.confirm.mockResolvedValueOnce(false);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    expect(exitCode).toBe(0);
    expect(existsSync(join(tempDir, ".env"))).toBe(true);
    const envContent = readFileSync(join(tempDir, ".env"), "utf-8");
    expect(envContent).toContain("OPENAI_API_KEY=sk-test-openai");
  });

  it("warns for anthropic/ models and does not write ANTHROPIC_API_KEY", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;

    p.multiselect.mockResolvedValueOnce(["whatsapp"]);
    p.text.mockResolvedValueOnce("anthropic/claude-opus-4"); // model
    p.confirm.mockResolvedValueOnce(false);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    expect(exitCode).toBe(0);
    expect(p.note).toHaveBeenCalledWith(
      expect.stringContaining("not supported by this project's default policy"),
      "Anthropic not supported by default"
    );
    const envPath = join(tempDir, ".env");
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, "utf-8");
      expect(envContent).not.toContain("ANTHROPIC_API_KEY");
    }
  });
});

describe("InitCommand: invalid input rejection (cancel handling)", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-init-cancel-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns exit code 1 when channels prompt is cancelled", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;
    p.multiselect.mockResolvedValueOnce(CANCEL_SENTINEL);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    expect(exitCode).toBe(1);
  });

  it("returns exit code 1 when telegram token prompt is cancelled", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;
    p.multiselect.mockResolvedValueOnce(["telegram"]);
    p.text.mockResolvedValueOnce(CANCEL_SENTINEL);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    expect(exitCode).toBe(1);
  });

  it("returns exit code 1 when model text input is cancelled (no __custom__ option needed)", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;
    p.multiselect.mockResolvedValueOnce(["whatsapp"]);
    p.text.mockResolvedValueOnce(CANCEL_SENTINEL); // model prompt cancelled

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    const exitCode = await cmd.execute();

    expect(exitCode).toBe(1);
  });

  it("does not write config file when setup is cancelled early", async () => {
    const clack = await getClack();
    const p = clack as Record<string, ReturnType<typeof vi.fn>>;
    p.multiselect.mockResolvedValueOnce(CANCEL_SENTINEL);

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    expect(existsSync(join(tempDir, "iris.config.json"))).toBe(false);
  });
});

describe("InitCommand: config structure", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-init-structure-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("written config has the correct basic structure", async () => {
    await setupHappyPathMocks();

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const config = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    expect(config).toMatchObject({
      models: { primary: expect.any(String), small: expect.any(String) },
      channels: expect.any(Object),
    });
  });

  it("telegram channel config uses env-var reference for token", async () => {
    await setupHappyPathMocks("123:secret");

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const config = JSON.parse(readFileSync(join(tempDir, "iris.config.json"), "utf-8"));
    expect(config.channels.telegram).toBeDefined();
    expect(config.channels.telegram.token).toBe("${env:TELEGRAM_BOT_TOKEN}");
    // Raw token must NOT be in config
    expect(JSON.stringify(config)).not.toContain("123:secret");
  });

  it("written config is valid JSON", async () => {
    await setupHappyPathMocks();

    const { InitCommand } = await import("../../src/cli/commands/init.js");
    const cmd = new InitCommand();
    await cmd.execute();

    const raw = readFileSync(join(tempDir, "iris.config.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});


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
