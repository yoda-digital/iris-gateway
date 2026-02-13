import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CronService } from "../../src/cron/service.js";
import { CronStore } from "../../src/cron/store.js";

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
  } as any;
}

function mockBridge() {
  return {
    createSession: vi.fn().mockResolvedValue({ id: "session-1" }),
    sendMessage: vi.fn().mockResolvedValue("Response from AI"),
  };
}

function mockRouter() {
  return {
    sendResponse: vi.fn().mockResolvedValue(undefined),
  };
}

describe("CronService", () => {
  let tempDir: string;
  let store: CronStore;
  let bridge: ReturnType<typeof mockBridge>;
  let router: ReturnType<typeof mockRouter>;
  let logger: ReturnType<typeof mockLogger>;
  let service: CronService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-cron-svc-"));
    store = new CronStore(tempDir);
    bridge = mockBridge();
    router = mockRouter();
    logger = mockLogger();
    service = new CronService(store, bridge, router, logger);
  });

  afterEach(() => {
    service.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts with no jobs", async () => {
    await service.start();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 0 }),
      "Cron service started",
    );
  });

  it("starts with existing enabled jobs from store", async () => {
    await store.add({
      name: "test-job",
      schedule: "0 9 * * *",
      prompt: "Hello",
      channel: "telegram",
      chatId: "123",
      enabled: true,
    });
    await service.start();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      "Cron service started",
    );
  });

  it("skips disabled jobs during start", async () => {
    await store.add({
      name: "disabled-job",
      schedule: "0 9 * * *",
      prompt: "Hello",
      channel: "telegram",
      chatId: "123",
      enabled: false,
    });
    await service.start();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 0 }),
      "Cron service started",
    );
  });

  it("adds a job and schedules it", async () => {
    await service.start();
    await service.addJob({
      name: "new-job",
      schedule: "0 10 * * *",
      prompt: "Do something",
      channel: "discord",
      chatId: "456",
      enabled: true,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ job: "new-job" }),
      "Added cron job",
    );
  });

  it("removes a job", async () => {
    await store.add({
      name: "to-remove",
      schedule: "0 9 * * *",
      prompt: "Hello",
      channel: "telegram",
      chatId: "123",
      enabled: true,
    });
    await service.start();

    const removed = await service.removeJob("to-remove");
    expect(removed).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ job: "to-remove" }),
      "Removed cron job",
    );
  });

  it("returns false when removing nonexistent job", async () => {
    await service.start();
    const removed = await service.removeJob("nonexistent");
    expect(removed).toBe(false);
  });

  it("stops all scheduled jobs", async () => {
    await store.add({
      name: "job-1",
      schedule: "0 9 * * *",
      prompt: "Hello",
      channel: "telegram",
      chatId: "123",
      enabled: true,
    });
    await service.start();
    service.stop();
    expect(logger.info).toHaveBeenCalledWith("Cron service stopped");
  });
});
