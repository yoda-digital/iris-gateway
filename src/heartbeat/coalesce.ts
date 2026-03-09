export interface CoalescerDeps {
  readonly coalesceMs: number;
  readonly retryMs: number;
  readonly getInFlightCount: () => number;
}

export class HeartbeatCoalescer {
  private readonly coalesceMs: number;
  private readonly retryMs: number;
  private readonly getInFlightCount: () => number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: CoalescerDeps) {
    this.coalesceMs = deps.coalesceMs;
    this.retryMs = deps.retryMs;
    this.getInFlightCount = deps.getInFlightCount;
  }

  requestRun(runner: () => Promise<void>): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.tryRun(runner);
    }, this.coalesceMs);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private tryRun(runner: () => Promise<void>): void {
    if (this.getInFlightCount() > 0) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.tryRun(runner);
      }, this.retryMs);
      return;
    }
    runner().catch(() => {});
  }
}
