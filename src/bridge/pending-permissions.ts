/**
 * Manages pending permission requests awaiting user response via /perm command.
 * Similar to turn-grouper.ts but tracks permissions instead of response contexts.
 */

import type { Permission } from "./opencode-client.js";

const PENDING_TTL_MS = 5 * 60_000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

export interface PendingPermission extends Permission {
  channelId: string;
  chatId: string;
  createdAt: number;
}

export class PendingPermissions {
  private readonly pending = new Map<string, PendingPermission>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onPrune?: (key: string, permission: PendingPermission) => void) {
    this.cleanupTimer = setInterval(
      () => this.pruneStale(),
      CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref();
  }

  /**
   * Build a unique key for tracking permissions by channel and chat.
   * Using channelId:chatId instead of sessionId allows users to respond
   * from the same chat where the permission was requested.
   */
  private buildKey(channelId: string, chatId: string): string {
    return `${channelId}:${chatId}`;
  }

  set(channelId: string, chatId: string, permission: Permission): void {
    const key = this.buildKey(channelId, chatId);
    this.pending.set(key, { ...permission, channelId, chatId, createdAt: Date.now() });
  }

  get(channelId: string, chatId: string): PendingPermission | undefined {
    const key = this.buildKey(channelId, chatId);
    return this.pending.get(key);
  }

  delete(channelId: string, chatId: string): void {
    const key = this.buildKey(channelId, chatId);
    this.pending.delete(key);
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private pruneStale(): void {
    const now = Date.now();
    for (const [key, pending] of this.pending) {
      if (now - pending.createdAt > PENDING_TTL_MS) {
        this.pending.delete(key);
        this.onPrune?.(key, pending);
      }
    }
  }
}
