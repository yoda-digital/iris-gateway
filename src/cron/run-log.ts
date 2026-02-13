import type { Logger } from "../logging/logger.js";

export interface CronRunEntry {
  readonly jobName: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly success: boolean;
  readonly error?: string;
}

export class CronRunLogger {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: "cron-run" });
  }

  logRun(entry: CronRunEntry): void {
    const duration = entry.completedAt - entry.startedAt;
    if (entry.success) {
      this.logger.info(
        { job: entry.jobName, durationMs: duration },
        "Cron job completed",
      );
    } else {
      this.logger.error(
        { job: entry.jobName, durationMs: duration, error: entry.error },
        "Cron job failed",
      );
    }
  }
}
