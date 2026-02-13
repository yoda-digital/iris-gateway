import { Cron } from "croner";
import type { CronStore, CronJob } from "./store.js";
import { CronRunLogger } from "./run-log.js";
import type { Logger } from "../logging/logger.js";

interface CronBridge {
  createSession(title?: string): Promise<{ id: string }>;
  sendMessage(sessionId: string, text: string): Promise<string>;
}

interface CronRouter {
  sendResponse(
    channelId: string,
    chatId: string,
    text: string,
  ): Promise<void>;
}

export class CronService {
  private readonly scheduled = new Map<string, Cron>();
  private readonly sessions = new Map<string, string>();
  private readonly runLogger: CronRunLogger;

  constructor(
    private readonly store: CronStore,
    private readonly bridge: CronBridge,
    private readonly router: CronRouter,
    private readonly logger: Logger,
  ) {
    this.runLogger = new CronRunLogger(logger);
  }

  async start(): Promise<void> {
    const jobs = await this.store.load();
    for (const job of jobs) {
      if (job.enabled) {
        this.schedule(job);
      }
    }
    this.logger.info(
      { count: this.scheduled.size },
      "Cron service started",
    );
  }

  stop(): void {
    for (const [name, cron] of this.scheduled) {
      cron.stop();
      this.logger.debug({ job: name }, "Stopped cron job");
    }
    this.scheduled.clear();
    this.logger.info("Cron service stopped");
  }

  async addJob(job: CronJob): Promise<void> {
    await this.store.add(job);
    if (job.enabled) {
      this.schedule(job);
    }
    this.logger.info({ job: job.name, schedule: job.schedule }, "Added cron job");
  }

  async removeJob(name: string): Promise<boolean> {
    const removed = await this.store.remove(name);
    if (!removed) return false;

    const existing = this.scheduled.get(name);
    if (existing) {
      existing.stop();
      this.scheduled.delete(name);
    }
    this.sessions.delete(name);
    this.logger.info({ job: name }, "Removed cron job");
    return true;
  }

  private schedule(job: CronJob): void {
    const existing = this.scheduled.get(job.name);
    if (existing) {
      existing.stop();
    }

    const cron = new Cron(job.schedule, () => {
      this.execute(job).catch((err) => {
        this.logger.error({ err, job: job.name }, "Unhandled cron execution error");
      });
    });

    this.scheduled.set(job.name, cron);
    this.logger.debug({ job: job.name, schedule: job.schedule }, "Scheduled cron job");
  }

  private async execute(job: CronJob): Promise<void> {
    const startedAt = Date.now();
    try {
      let sessionId = this.sessions.get(job.name);
      if (!sessionId) {
        const session = await this.bridge.createSession(`cron:${job.name}`);
        sessionId = session.id;
        this.sessions.set(job.name, sessionId);
      }

      const response = await this.bridge.sendMessage(sessionId, job.prompt);
      await this.router.sendResponse(job.channel, job.chatId, response);

      this.runLogger.logRun({
        jobName: job.name,
        startedAt,
        completedAt: Date.now(),
        success: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.runLogger.logRun({
        jobName: job.name,
        startedAt,
        completedAt: Date.now(),
        success: false,
        error: message,
      });
    }
  }
}
