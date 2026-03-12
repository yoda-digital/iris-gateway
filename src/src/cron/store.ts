import { readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { withFileLock } from "../utils/file-lock.js";

export interface CronJob {
  readonly name: string;
  readonly schedule: string;
  readonly prompt: string;
  readonly channel: string;
  readonly chatId: string;
  readonly enabled: boolean;
}

export class CronStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, "cron-jobs.json");
  }

  async load(): Promise<CronJob[]> {
    return withFileLock(this.filePath, async () => {
      return this.readJobs();
    });
  }

  async save(jobs: CronJob[]): Promise<void> {
    return withFileLock(this.filePath, async () => {
      await this.writeJobs(jobs);
    });
  }

  async add(job: CronJob): Promise<void> {
    return withFileLock(this.filePath, async () => {
      const jobs = await this.readJobs();
      const idx = jobs.findIndex((j) => j.name === job.name);
      if (idx !== -1) {
        jobs[idx] = job;
      } else {
        jobs.push(job);
      }
      await this.writeJobs(jobs);
    });
  }

  async remove(name: string): Promise<boolean> {
    return withFileLock(this.filePath, async () => {
      const jobs = await this.readJobs();
      const idx = jobs.findIndex((j) => j.name === name);
      if (idx === -1) return false;
      jobs.splice(idx, 1);
      await this.writeJobs(jobs);
      return true;
    });
  }

  async list(): Promise<CronJob[]> {
    return this.load();
  }

  private async readJobs(): Promise<CronJob[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as CronJob[];
    } catch {
      return [];
    }
  }

  private async writeJobs(jobs: CronJob[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(jobs, null, 2));
  }
}
