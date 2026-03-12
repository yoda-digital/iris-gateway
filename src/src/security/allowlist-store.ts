import { readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { withFileLock } from "../utils/file-lock.js";

export interface AllowlistEntry {
  readonly channelId: string;
  readonly senderId: string;
  readonly approvedBy?: string;
  readonly approvedAt: number;
}

export class AllowlistStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, "allowlist.json");
  }

  async isAllowed(channelId: string, senderId: string): Promise<boolean> {
    const entries = await this.readEntries();
    return entries.some(
      (e) => e.channelId === channelId && e.senderId === senderId,
    );
  }

  async add(
    channelId: string,
    senderId: string,
    approvedBy?: string,
  ): Promise<void> {
    await withFileLock(this.filePath, async () => {
      const entries = await this.readEntries();
      const exists = entries.some(
        (e) => e.channelId === channelId && e.senderId === senderId,
      );
      if (!exists) {
        entries.push({ channelId, senderId, approvedBy, approvedAt: Date.now() });
        await this.writeEntries(entries);
      }
    });
  }

  async remove(channelId: string, senderId: string): Promise<boolean> {
    return withFileLock(this.filePath, async () => {
      const entries = await this.readEntries();
      const filtered = entries.filter(
        (e) => !(e.channelId === channelId && e.senderId === senderId),
      );
      const removed = filtered.length < entries.length;
      if (removed) await this.writeEntries(filtered);
      return removed;
    });
  }

  async list(channelId: string): Promise<AllowlistEntry[]> {
    const entries = await this.readEntries();
    return entries.filter((e) => e.channelId === channelId);
  }

  private async readEntries(): Promise<AllowlistEntry[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as AllowlistEntry[];
    } catch {
      return [];
    }
  }

  private async writeEntries(entries: AllowlistEntry[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(entries, null, 2));
  }
}
