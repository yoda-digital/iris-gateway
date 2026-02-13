import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { CronStore } from "../../src/cron/store.js";

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

describe("CLI: CronListCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-cron-cli-"));
    vi.stubEnv("IRIS_STATE_DIR", tempDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows empty when no cron jobs", async () => {
    const { CronListCommand } = await import(
      "../../src/cli/commands/cron-cmd.js"
    );
    const cmd = new CronListCommand();
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("No cron jobs configured");
  });

  it("lists existing cron jobs", async () => {
    const store = new CronStore(tempDir);
    await store.add({
      name: "daily-check",
      schedule: "0 9 * * *",
      prompt: "Check health",
      channel: "telegram",
      chatId: "123",
      enabled: true,
    });

    const { CronListCommand } = await import(
      "../../src/cli/commands/cron-cmd.js"
    );
    const cmd = new CronListCommand();
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    const text = output();
    expect(text).toContain("Cron jobs (1)");
    expect(text).toContain("daily-check");
    expect(text).toContain("enabled");
    expect(text).toContain("0 9 * * *");
  });
});

describe("CLI: CronAddCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-cron-add-"));
    vi.stubEnv("IRIS_STATE_DIR", tempDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds a cron job", async () => {
    const { CronAddCommand } = await import(
      "../../src/cli/commands/cron-cmd.js"
    );
    const cmd = new CronAddCommand();
    cmd.name = "weekly-report";
    cmd.schedule = "0 10 * * 1";
    cmd.prompt = "Generate weekly report";
    cmd.channel = "discord";
    cmd.chatId = "456";
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    const text = output();
    expect(text).toContain("Added cron job: weekly-report");
    expect(text).toContain("0 10 * * 1");

    // Verify it was stored
    const store = new CronStore(tempDir);
    const jobs = await store.list();
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.name).toBe("weekly-report");
  });
});

describe("CLI: CronRemoveCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-cron-rm-"));
    vi.stubEnv("IRIS_STATE_DIR", tempDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("removes an existing cron job", async () => {
    const store = new CronStore(tempDir);
    await store.add({
      name: "to-remove",
      schedule: "0 9 * * *",
      prompt: "Check",
      channel: "telegram",
      chatId: "123",
      enabled: true,
    });

    const { CronRemoveCommand } = await import(
      "../../src/cli/commands/cron-cmd.js"
    );
    const cmd = new CronRemoveCommand();
    cmd.name = "to-remove";
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("Removed cron job: to-remove");
  });

  it("reports when job not found", async () => {
    const { CronRemoveCommand } = await import(
      "../../src/cli/commands/cron-cmd.js"
    );
    const cmd = new CronRemoveCommand();
    cmd.name = "nonexistent";
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream };

    await cmd.execute();

    expect(output()).toContain("Cron job not found: nonexistent");
  });
});
