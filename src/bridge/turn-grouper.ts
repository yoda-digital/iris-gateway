/**
 * Manages pending-response tracking and stale-entry pruning.
 * Extracted from message-router.ts to keep that file under 250 lines.
 */

const PENDING_TTL_MS = 5 * 60_000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

export interface PendingResponse {
  channelId: string;
  chatId: string;
  replyToId?: string;
  createdAt: number;
}

export class TurnGrouper {
  private readonly pendingResponses = new Map<string, PendingResponse>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onPrune?: (sessionId: string) => void) {
    this.cleanupTimer = setInterval(
      () => this.pruneStale(),
      CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref();
  }

  set(sessionId: string, ctx: Omit<PendingResponse, "createdAt">): void {
    this.pendingResponses.set(sessionId, { ...ctx, createdAt: Date.now() });
  }

  get(sessionId: string): PendingResponse | undefined {
    return this.pendingResponses.get(sessionId);
  }

  delete(sessionId: string): void {
    this.pendingResponses.delete(sessionId);
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private pruneStale(): void {
    const now = Date.now();
    for (const [sessionId, pending] of this.pendingResponses) {
      if (now - pending.createdAt > PENDING_TTL_MS) {
        this.pendingResponses.delete(sessionId);
        this.onPrune?.(sessionId);
      }
    }
  }
}
