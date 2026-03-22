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


describe("CronService — execute() lifecycle (fake timers)", () => {
  let tempDir: string;
  let store: CronStore;
  let bridge: ReturnType<typeof mockBridge>;
  let router: ReturnType<typeof mockRouter>;
  let logger: ReturnType<typeof mockLogger>;
  let service: CronService;

  const jobEverySecond = {
    name: "exec-job",
    schedule: "* * * * * *",
    prompt: "Do work",
    channel: "telegram",
    chatId: "999",
    enabled: true,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), "iris-cron-exec-"));
    store = new CronStore(tempDir);
    bridge = mockBridge();
    router = mockRouter();
    logger = mockLogger();
    service = new CronService(store, bridge, router, logger);
  });

  afterEach(async () => {
    service.stop();
    vi.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("execute() creates a session and sends response on success", async () => {
    await service.addJob(jobEverySecond);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve(); await Promise.resolve();
    expect(bridge.createSession).toHaveBeenCalledWith("cron:exec-job");
    expect(bridge.sendMessage).toHaveBeenCalledWith("session-1", "Do work");
    expect(router.sendResponse).toHaveBeenCalledWith("telegram", "999", "Response from AI");
  });

  it("execute() reuses existing session on repeated ticks", async () => {
    await service.addJob(jobEverySecond);
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.resolve(); await Promise.resolve();
    // Session created exactly once, message sent multiple times
    expect(bridge.createSession).toHaveBeenCalledTimes(1);
    expect(bridge.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("execute() catches error from sendMessage (Error instance)", async () => {
    bridge.sendMessage.mockRejectedValue(new Error("bridge failure"));
    await service.addJob(jobEverySecond);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve(); await Promise.resolve();
    // execute() catches internally — no crash, logger.error not called from execute()
    expect(bridge.sendMessage).toHaveBeenCalled();
    expect(logger.fatal).not.toHaveBeenCalled();
  });

  it("execute() catches non-Error throw via String(err) branch", async () => {
    bridge.sendMessage.mockRejectedValue("plain string error");
    await service.addJob(jobEverySecond);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve(); await Promise.resolve();
    expect(bridge.sendMessage).toHaveBeenCalled();
    expect(logger.fatal).not.toHaveBeenCalled();
  });

  it("schedule() replaces existing cron when same job name is re-added", async () => {
    await service.addJob({ ...jobEverySecond });
    await service.addJob({ ...jobEverySecond, schedule: "*/2 * * * * *" });
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ job: "exec-job" }),
      "Scheduled cron job",
    );
  });

  it("stop() emits debug log per scheduled job", async () => {
    await service.addJob(jobEverySecond);
    service.stop();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ job: "exec-job" }),
      "Stopped cron job",
    );
  });

  it("removeJob removes session and returns false on second removal attempt", async () => {
    await service.addJob(jobEverySecond);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve(); await Promise.resolve();
    const removed = await service.removeJob("exec-job");
    expect(removed).toBe(true);
    const removedAgain = await service.removeJob("exec-job");
    expect(removedAgain).toBe(false);
  });
});
