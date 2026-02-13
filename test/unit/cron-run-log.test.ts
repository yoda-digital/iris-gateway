import { describe, it, expect, vi } from "vitest";
import { CronRunLogger } from "../../src/cron/run-log.js";

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

describe("CronRunLogger", () => {
  it("logs successful run with duration", () => {
    const logger = mockLogger();
    const runLogger = new CronRunLogger(logger);

    runLogger.logRun({
      jobName: "daily-check",
      startedAt: 1000,
      completedAt: 2500,
      success: true,
    });

    // child() is called first, then info on the child
    expect(logger.child).toHaveBeenCalledWith({ component: "cron-run" });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ job: "daily-check", durationMs: 1500 }),
      "Cron job completed",
    );
  });

  it("logs failed run with error message", () => {
    const logger = mockLogger();
    const runLogger = new CronRunLogger(logger);

    runLogger.logRun({
      jobName: "weekly-report",
      startedAt: 1000,
      completedAt: 3000,
      success: false,
      error: "Connection timeout",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        job: "weekly-report",
        durationMs: 2000,
        error: "Connection timeout",
      }),
      "Cron job failed",
    );
  });
});
