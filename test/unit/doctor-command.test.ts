import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DoctorCommand } from "../../src/cli/commands/doctor.js";

// We test DoctorCommand by instantiating it with a mocked stdout context
// and mocking the FS/config dependencies.

vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../src/config/paths.js", () => ({
  getConfigPath: vi.fn().mockReturnValue("/mock/iris.config.json"),
  getStateDir: vi.fn().mockReturnValue("/mock/.iris"),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    accessSync: vi.fn(),
    mkdirSync: vi.fn(),
    constants: actual.constants,
  };
});

import { loadConfig } from "../../src/config/loader.js";
import { accessSync, mkdirSync } from "node:fs";

function buildCommand(output: string[] = []) {
  const cmd = new DoctorCommand();
  (cmd as any).context = {
    stdout: {
      write: (s: string) => { output.push(s); },
    },
  };
  return cmd;
}

function mockGoodConfig() {
  (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
    opencode: { hostname: "localhost", port: 3000 },
    channels: {
      telegram: { enabled: true },
    },
  });
}

describe("DoctorCommand — config check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (accessSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (mkdirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    // Silence process.exitCode assignment
  });

  it("writes header on execute", async () => {
    mockGoodConfig();
    const output: string[] = [];
    const cmd = buildCommand(output);
    // Mock fetch to simulate OpenCode reachable
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await cmd.execute();
    expect(output[0]).toContain("Iris Doctor");
  });

  it("outputs PASS for valid config", async () => {
    mockGoodConfig();
    const output: string[] = [];
    const cmd = buildCommand(output);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await cmd.execute();
    const joined = output.join("");
    expect(joined).toContain("[PASS] Config valid");
  });

  it("outputs FAIL for invalid config", async () => {
    (loadConfig as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("bad config");
    });
    const output: string[] = [];
    const cmd = buildCommand(output);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await cmd.execute();
    const joined = output.join("");
    expect(joined).toContain("[FAIL] Config invalid");
    expect(joined).toContain("bad config");
  });
});

describe("DoctorCommand — state dir check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoodConfig();
  });

  it("outputs PASS when state dir is writable", async () => {
    (accessSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (mkdirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const output: string[] = [];
    const cmd = buildCommand(output);
    await cmd.execute();
    expect(output.join("")).toContain("[PASS] State dir writable");
  });

  it("outputs FAIL when state dir is not writable", async () => {
    (accessSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("EACCES");
    });
    (mkdirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const output: string[] = [];
    const cmd = buildCommand(output);
    await cmd.execute();
    expect(output.join("")).toContain("[FAIL] State dir not writable");
  });
});

describe("DoctorCommand — OpenCode reachability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (accessSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (mkdirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    mockGoodConfig();
  });

  it("outputs PASS when OpenCode /health returns ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const output: string[] = [];
    await buildCommand(output).execute();
    expect(output.join("")).toContain("[PASS] OpenCode reachable");
  });

  it("outputs FAIL when OpenCode returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const output: string[] = [];
    await buildCommand(output).execute();
    expect(output.join("")).toContain("[FAIL] OpenCode returned status 503");
  });

  it("outputs FAIL when fetch throws (not reachable)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const output: string[] = [];
    await buildCommand(output).execute();
    expect(output.join("")).toContain("[FAIL] OpenCode not reachable");
  });
});

describe("DoctorCommand — channels check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (accessSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (mkdirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  it("outputs PASS when at least one channel is enabled", async () => {
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      opencode: { hostname: "localhost", port: 3000 },
      channels: { telegram: { enabled: true }, discord: { enabled: false } },
    });
    const output: string[] = [];
    await buildCommand(output).execute();
    expect(output.join("")).toContain("[PASS] Channels configured");
  });

  it("outputs FAIL when no channels are configured", async () => {
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      opencode: { hostname: "localhost", port: 3000 },
      channels: {},
    });
    const output: string[] = [];
    await buildCommand(output).execute();
    expect(output.join("")).toContain("[FAIL] No channels configured");
  });

  it("outputs FAIL when all channels are disabled", async () => {
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      opencode: { hostname: "localhost", port: 3000 },
      channels: { telegram: { enabled: false } },
    });
    const output: string[] = [];
    await buildCommand(output).execute();
    expect(output.join("")).toContain("[FAIL] No enabled channels");
  });

  it("outputs All checks passed when everything is ok", async () => {
    (loadConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      opencode: { hostname: "localhost", port: 3000 },
      channels: { telegram: { enabled: true } },
    });
    const output: string[] = [];
    await buildCommand(output).execute();
    expect(output.join("")).toContain("All checks passed");
  });

  it("outputs Some checks failed and sets exitCode 1 on failure", async () => {
    (loadConfig as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("broken");
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    const output: string[] = [];
    await buildCommand(output).execute();
    expect(output.join("")).toContain("Some checks failed");
    expect(process.exitCode).toBe(1);
  });
});
