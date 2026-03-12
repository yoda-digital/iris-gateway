import type { Logger } from "../logging/logger.js";
import { CircuitBreaker } from "./circuit-breaker.js";

export interface SupervisorOptions {
  /** Max restart attempts before giving up. Default: 5 */
  maxRestarts?: number;
  /** Initial backoff ms. Doubles each retry up to maxBackoffMs. Default: 1000 */
  initialBackoffMs?: number;
  /** Maximum backoff ms. Default: 30_000 */
  maxBackoffMs?: number;
  /** Health check interval ms. Default: 5000 */
  healthIntervalMs?: number;
  /** Max queued messages during restart window. Default: 50 */
  maxQueueSize?: number;
  /** Called when max restarts are exceeded (use for owner alerting). */
  onMaxRestartsExceeded?: () => void;
}

/**
 * BridgeSupervisor — handles health monitoring, circuit breaking, and restart logic
 * for the OpenCodeBridge. Extracted to keep opencode-client.ts under the 500-line limit.
 */
export class BridgeSupervisor {
  readonly circuitBreaker: CircuitBreaker;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private _restartAttempts = 0;
  private _isRestarting = false;
  readonly pendingQueue: Array<() => void> = [];

  get restartAttempts(): number { return this._restartAttempts; }

  private readonly maxRestarts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly healthIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly onMaxRestartsExceeded?: () => void;

  constructor(
    private readonly logger: Logger,
    private readonly checkHealthFn: () => Promise<boolean>,
    private readonly doStartFn: () => Promise<void>,
    private readonly teardownFn: () => void,
    opts: SupervisorOptions = {},
  ) {
    this.maxRestarts = opts.maxRestarts ?? 5;
    this.initialBackoffMs = opts.initialBackoffMs ?? 1_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.healthIntervalMs = opts.healthIntervalMs ?? 5_000;
    this.maxQueueSize = opts.maxQueueSize ?? 50;
    this.onMaxRestartsExceeded = opts.onMaxRestartsExceeded;
    this.circuitBreaker = new CircuitBreaker({ recoveryTimeoutMs: 15_000 });
  }

  startHealthMonitor(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      this._healthTick().catch((err) => {
        this.logger.warn({ err }, "Health tick error");
      });
    }, this.healthIntervalMs);
    this.healthTimer.unref?.();
  }

  stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async _healthTick(): Promise<void> {
    if (this._isRestarting) return;
    const healthy = await this.checkHealthFn();
    if (healthy) {
      if (this.circuitBreaker.getState() !== "CLOSED") {
        this.logger.info("OpenCode health restored — closing circuit");
        this.circuitBreaker.onSuccess();
        this._restartAttempts = 0;
        this.drainQueue();
      }
    } else {
      this.logger.warn("OpenCode health check failed — triggering supervisor restart");
      this.circuitBreaker.onFailure();
      this.scheduleRestart(0);
    }
  }

  scheduleRestart(attempt: number): void {
    if (this._isRestarting) return;
    if (attempt >= this.maxRestarts) {
      this.logger.error({ maxRestarts: this.maxRestarts }, "Max restarts exceeded — giving up");
      this.onMaxRestartsExceeded?.();
      return;
    }

    this._isRestarting = true;
    const backoff = Math.min(
      this.initialBackoffMs * Math.pow(2, attempt),
      this.maxBackoffMs,
    );
    this._restartAttempts = attempt + 1;
    this.logger.info({ attempt: attempt + 1, backoffMs: backoff }, "Scheduling OpenCode restart");

    setTimeout(async () => {
      let nextAttempt: number | null = null;
      try {
        this.logger.info("Restarting OpenCode...");
        this.teardownFn();
        await this.doStartFn();
        const healthy = await this.checkHealthFn();
        if (healthy) {
          this.logger.info("OpenCode restart succeeded");
          this.circuitBreaker.onSuccess();
          this._restartAttempts = 0;
          this.drainQueue();
        } else {
          this.logger.warn("OpenCode restart did not restore health");
          nextAttempt = attempt + 1;
        }
      } catch (err) {
        this.logger.error({ err }, "OpenCode restart failed");
        nextAttempt = attempt + 1;
      } finally {
        this._isRestarting = false;
      }
      if (nextAttempt !== null) this.scheduleRestart(nextAttempt);
    }, backoff);
  }

  drainQueue(): void {
    const pending = this.pendingQueue.splice(0);
    this.logger.info({ count: pending.length }, "Draining pending message queue");
    for (const resume of pending) {
      try { resume(); } catch { /* ignore */ }
    }
  }

  /**
   * If circuit is OPEN, queue this call and wait for recovery.
   * Returns false if the queue is full or circuit remains unhealthy after drain.
   */
  async waitForCircuit(): Promise<boolean> {
    if (this.circuitBreaker.allowRequest()) return true;
    if (this.pendingQueue.length >= this.maxQueueSize) {
      this.logger.warn("Pending queue full — dropping message");
      return false;
    }
    this.logger.info("Circuit OPEN — queuing message for later delivery");
    await new Promise<void>((resolve) => {
      this.pendingQueue.push(resolve);
    });
    return this.circuitBreaker.allowRequest();
  }
}
