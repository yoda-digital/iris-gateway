const DEFAULT_TTL_MS = 30 * 60_000; // 30 minutes
const DEFAULT_MAX_SIZE = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;

export interface MessageContext {
  readonly channelId: string;
  readonly chatId: string;
  readonly timestamp: number;
}

export class MessageCache {
  private readonly entries = new Map<string, MessageContext>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxSize = DEFAULT_MAX_SIZE,
  ) {
    this.cleanupTimer = setInterval(() => this.prune(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  set(messageId: string, context: MessageContext): void {
    if (this.entries.size >= this.maxSize) {
      // Evict oldest entry
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(messageId, context);
  }

  get(messageId: string): MessageContext | undefined {
    return this.entries.get(messageId);
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, ctx] of this.entries) {
      if (ctx.timestamp < cutoff) {
        this.entries.delete(id);
      }
    }
  }
}
