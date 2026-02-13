import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CronStore, type CronJob } from "../../src/cron/store.js";

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    name: "test-job",
    schedule: "0 * * * *",
    prompt: "Hello",
    channel: "telegram",
    chatId: "chat-1",
    enabled: true,
    ...overrides,
  };
}

describe("CronStore", () => {
  let tempDir: string;
  let store: CronStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-cron-test-"));
    writeFileSync(join(tempDir, "cron-jobs.json"), "[]");
    store = new CronStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty list when no jobs exist", async () => {
    const jobs = await store.list();
    expect(jobs).toEqual([]);
  });

  it("adds a job and lists it", async () => {
    const job = makeJob();
    await store.add(job);
    const jobs = await store.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(job);
  });

  it("replaces a job with the same name", async () => {
    await store.add(makeJob({ prompt: "v1" }));
    await store.add(makeJob({ prompt: "v2" }));
    const jobs = await store.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.prompt).toBe("v2");
  });

  it("removes a job by name", async () => {
    await store.add(makeJob());
    const removed = await store.remove("test-job");
    expect(removed).toBe(true);
    const jobs = await store.list();
    expect(jobs).toHaveLength(0);
  });

  it("returns false when removing non-existent job", async () => {
    const removed = await store.remove("no-such-job");
    expect(removed).toBe(false);
  });

  it("persists jobs to disk", async () => {
    await store.add(makeJob({ name: "persist-test" }));
    const raw = readFileSync(join(tempDir, "cron-jobs.json"), "utf-8");
    const onDisk = JSON.parse(raw) as CronJob[];
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]!.name).toBe("persist-test");
  });

  it("loads persisted jobs in a new store instance", async () => {
    await store.add(makeJob({ name: "reload-test" }));
    const store2 = new CronStore(tempDir);
    const jobs = await store2.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.name).toBe("reload-test");
  });

  it("handles empty state without pre-existing file", async () => {
    const freshDir = mkdtempSync(join(tmpdir(), "iris-cron-fresh-"));
    try {
      const freshStore = new CronStore(freshDir);
      const jobs = await freshStore.list();
      expect(jobs).toEqual([]);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it("saves and loads multiple jobs", async () => {
    await store.add(makeJob({ name: "job-a" }));
    await store.add(makeJob({ name: "job-b" }));
    await store.add(makeJob({ name: "job-c" }));
    const jobs = await store.list();
    expect(jobs).toHaveLength(3);
    const names = jobs.map((j) => j.name).sort();
    expect(names).toEqual(["job-a", "job-b", "job-c"]);
  });
});
