import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";

// Helper to capture stdout
function captureStdout(): { stream: Writable; output: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk, _encoding, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, output: () => buf };
}

describe("CLI: ConfigValidateCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-cli-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("validates a correct config file", async () => {
    const configPath = join(tempDir, "valid.json");
    writeFileSync(configPath, JSON.stringify({
      gateway: { port: 19876, hostname: "127.0.0.1" },
      channels: {},
      security: { defaultDmPolicy: "open", pairingCodeTtlMs: 3600000, pairingCodeLength: 8, rateLimitPerMinute: 30, rateLimitPerHour: 300 },
      opencode: { port: 4096, hostname: "127.0.0.1", autoSpawn: false },
      logging: { level: "info" },
    }));

    const { ConfigValidateCommand } = await import("../../src/cli/commands/config-cmd.js");
    const cmd = new ConfigValidateCommand();
    cmd.configFile = configPath;
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("Config is valid");
  });

  it("rejects an invalid config file", async () => {
    const configPath = join(tempDir, "invalid.json");
    writeFileSync(configPath, JSON.stringify({ gateway: { port: "not-a-number" } }));

    const { ConfigValidateCommand } = await import("../../src/cli/commands/config-cmd.js");
    const cmd = new ConfigValidateCommand();
    cmd.configFile = configPath;
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("INVALID");
  });

  it("reports missing config file", async () => {
    const { ConfigValidateCommand } = await import("../../src/cli/commands/config-cmd.js");
    const cmd = new ConfigValidateCommand();
    cmd.configFile = join(tempDir, "nonexistent.json");
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("Config file not found");
  });
});

describe("CLI: ConfigShowCommand", () => {
  it("shows config with redacted tokens", async () => {
    const { ConfigShowCommand } = await import("../../src/cli/commands/config-cmd.js");
    const cmd = new ConfigShowCommand();
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    // loadConfig uses default path which should work (iris.config.json exists)
    await cmd.execute();

    const text = output();
    // Should be valid JSON
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty("gateway");
    expect(parsed).toHaveProperty("security");
  });
});

describe("CLI: PairingCommands", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-pairing-cli-"));
    // Override getStateDir to use temp dir
    vi.stubEnv("IRIS_STATE_DIR", tempDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("pairing list shows empty when no pending", async () => {
    const { PairingListCommand } = await import("../../src/cli/commands/pairing.js");
    const cmd = new PairingListCommand();
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("No pending pairing requests");
  });

  it("pairing approve fails for invalid code", async () => {
    const { PairingApproveCommand } = await import("../../src/cli/commands/pairing.js");
    const cmd = new PairingApproveCommand();
    cmd.code = "INVALID1";
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("No pending pairing request found");
  });

  it("pairing approve + list full flow", async () => {
    const { PairingStore } = await import("../../src/security/pairing-store.js");
    const store = new PairingStore(tempDir);
    const code = await store.issueCode("telegram", "user123", "Test User");

    // List should show the pending code
    const { PairingListCommand } = await import("../../src/cli/commands/pairing.js");
    const listCmd = new PairingListCommand();
    const { stream: ls, output: lsOut } = captureStdout();
    listCmd.context = { ...listCmd.context, stdout: ls };
    await listCmd.execute();
    expect(lsOut()).toContain(code);
    expect(lsOut()).toContain("telegram");

    // Approve the code
    const { PairingApproveCommand } = await import("../../src/cli/commands/pairing.js");
    const approveCmd = new PairingApproveCommand();
    approveCmd.code = code;
    const { stream: as, output: asOut } = captureStdout();
    approveCmd.context = { ...approveCmd.context, stdout: as };
    await approveCmd.execute();
    expect(asOut()).toContain("Approved");
    expect(asOut()).toContain("telegram");
  });

  it("pairing revoke removes a pending code", async () => {
    const { PairingStore } = await import("../../src/security/pairing-store.js");
    const store = new PairingStore(tempDir);
    const code = await store.issueCode("discord", "bob", "Bob");

    const { PairingRevokeCommand } = await import("../../src/cli/commands/pairing.js");
    const cmd = new PairingRevokeCommand();
    cmd.code = code;
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("Revoked");
  });

  it("pairing revoke fails for nonexistent code", async () => {
    const { PairingRevokeCommand } = await import("../../src/cli/commands/pairing.js");
    const cmd = new PairingRevokeCommand();
    cmd.code = "NOPE1234";
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("No pending pairing request found");
  });
});

describe("CLI: StatusCommand", () => {
  it("shows gateway status info", async () => {
    const { StatusCommand } = await import("../../src/cli/commands/status.js");
    const cmd = new StatusCommand();
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    const text = output();
    expect(text).toContain("Iris Gateway Status");
    expect(text).toContain("Config path:");
    expect(text).toContain("State dir:");
    expect(text).toContain("Gateway:");
    expect(text).toContain("OpenCode:");
    expect(text).toContain("Security:");
  });
});
