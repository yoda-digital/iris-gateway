import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { detectMime, getExtensionForMime } from "./mime.js";

export interface MediaEntry {
  readonly id: string;
  readonly mimeType: string;
  readonly filename: string;
  readonly size: number;
  readonly path: string;
  readonly createdAt: number;
}

const DEFAULT_TTL_MS = 30 * 60_000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes

export class MediaStore {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly baseDir: string,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {
    mkdirSync(baseDir, { recursive: true });
    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  async save(
    buffer: Buffer,
    options?: { mimeType?: string; filename?: string },
  ): Promise<MediaEntry> {
    const id = randomUUID();
    const mimeType = options?.mimeType ?? detectMime(buffer, options?.filename);
    const ext =
      options?.filename ? extname(options.filename) : getExtensionForMime(mimeType);
    const filename = options?.filename ?? `${id}${ext}`;
    const path = join(this.baseDir, `${id}${ext}`);

    await writeFile(path, buffer);

    return {
      id,
      mimeType,
      filename,
      size: buffer.length,
      path,
      createdAt: Date.now(),
    };
  }

  async get(id: string): Promise<Buffer | null> {
    const files = await readdir(this.baseDir);
    const match = files.find((f) => f.startsWith(id));
    if (!match) return null;
    return readFile(join(this.baseDir, match));
  }

  async getEntry(id: string): Promise<MediaEntry | null> {
    const files = await readdir(this.baseDir);
    const match = files.find((f) => f.startsWith(id));
    if (!match) return null;

    const path = join(this.baseDir, match);
    const info = await stat(path);
    const mimeType = detectMime(null, match);

    return {
      id,
      mimeType,
      filename: match,
      size: info.size,
      path,
      createdAt: info.mtimeMs,
    };
  }

  async delete(id: string): Promise<boolean> {
    const files = await readdir(this.baseDir);
    const match = files.find((f) => f.startsWith(id));
    if (!match) return false;
    await unlink(join(this.baseDir, match));
    return true;
  }

  async cleanup(): Promise<number> {
    const cutoff = Date.now() - this.ttlMs;
    const files = await readdir(this.baseDir);
    let removed = 0;

    for (const file of files) {
      const path = join(this.baseDir, file);
      try {
        const info = await stat(path);
        if (info.mtimeMs < cutoff) {
          await unlink(path);
          removed++;
        }
      } catch {
        // File may have been deleted concurrently
      }
    }

    return removed;
  }

  /** Get full path for serving a media file */
  getFilePath(id: string, files?: string[]): string | null {
    // Synchronous check using pre-cached file list or return pattern
    return join(this.baseDir, id);
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
