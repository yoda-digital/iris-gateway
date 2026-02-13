import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { AllowlistStore } from "../../src/security/allowlist-store.js";

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

describe("CLI: SecurityAllowlistListCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-sec-cli-"));
    vi.stubEnv("IRIS_STATE_DIR", tempDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows empty when no entries", async () => {
    const { SecurityAllowlistListCommand } = await import(
      "../../src/cli/commands/security.js"
    );
    const cmd = new SecurityAllowlistListCommand();
    cmd.channel = "telegram";
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("No allowlist entries");
  });

  it("lists entries after adding", async () => {
    const store = new AllowlistStore(tempDir);
    await store.add("telegram", "alice123", "test");

    const { SecurityAllowlistListCommand } = await import(
      "../../src/cli/commands/security.js"
    );
    const cmd = new SecurityAllowlistListCommand();
    cmd.channel = "telegram";
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    const text = output();
    expect(text).toContain("Allowlist for telegram");
    expect(text).toContain("alice123");
    expect(text).toContain("approved-by=test");
  });
});

describe("CLI: SecurityAllowlistAddCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-sec-add-"));
    vi.stubEnv("IRIS_STATE_DIR", tempDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds a sender to the allowlist", async () => {
    const { SecurityAllowlistAddCommand } = await import(
      "../../src/cli/commands/security.js"
    );
    const cmd = new SecurityAllowlistAddCommand();
    cmd.channel = "discord";
    cmd.senderId = "bob456";
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("Added bob456");
    expect(output()).toContain("discord");

    // Verify it was actually stored
    const store = new AllowlistStore(tempDir);
    expect(await store.isAllowed("discord", "bob456")).toBe(true);
  });
});
