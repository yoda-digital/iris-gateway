export interface RateLimitConfig {
  readonly perMinute: number;
  readonly perHour: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterMs?: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly config: RateLimitConfig) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    const timestamps = this.getTimestamps(key, now);

    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3_600_000;

    const minuteCount = timestamps.filter((t) => t > oneMinuteAgo).length;
    if (minuteCount >= this.config.perMinute) {
      const oldest = timestamps.find((t) => t > oneMinuteAgo)!;
      return { allowed: false, retryAfterMs: oldest + 60_000 - now };
    }

    const hourCount = timestamps.filter((t) => t > oneHourAgo).length;
    if (hourCount >= this.config.perHour) {
      const oldest = timestamps.find((t) => t > oneHourAgo)!;
      return { allowed: false, retryAfterMs: oldest + 3_600_000 - now };
    }

    return { allowed: true };
  }

  hit(key: string): void {
    const now = Date.now();
    const timestamps = this.getTimestamps(key, now);
    timestamps.push(now);
    this.windows.set(key, timestamps);
  }

  private getTimestamps(key: string, now: number): number[] {
    const existing = this.windows.get(key) ?? [];
    const oneHourAgo = now - 3_600_000;
    const pruned = existing.filter((t) => t > oneHourAgo);
    if (pruned.length === 0) {
      this.windows.delete(key);
    } else {
      this.windows.set(key, pruned);
    }
    return pruned;
  }
}
