/**
 * Circuit breaker for OpenCode bridge reliability.
 *
 * States:
 *   CLOSED    - normal operation, requests pass through
 *   OPEN      - bridge is down, reject immediately with user-visible message
 *   HALF_OPEN - testing recovery, let one request through
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 3 */
  failureThreshold?: number;
  /** How long (ms) to stay OPEN before attempting HALF_OPEN. Default: 10_000 */
  recoveryTimeoutMs?: number;
  /** Message sent to users when circuit is OPEN. */
  unavailableMessage?: string;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;

  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  readonly unavailableMessage: string;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.recoveryTimeoutMs = opts.recoveryTimeoutMs ?? 10_000;
    this.unavailableMessage =
      opts.unavailableMessage ??
      "\u26a0\ufe0f I am temporarily unavailable \u2014 my AI backend is restarting. I'll respond shortly.";
  }

  /** Returns true if the request should proceed. */
  allowRequest(): boolean {
    if (this.state === "CLOSED") return true;

    if (this.state === "OPEN") {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed >= this.recoveryTimeoutMs) {
        this.state = "HALF_OPEN";
        this.halfOpenInFlight = false;
      } else {
        return false;
      }
    }

    // HALF_OPEN - allow exactly one probe request
    if (this.state === "HALF_OPEN") {
      if (this.halfOpenInFlight) return false;
      this.halfOpenInFlight = true;
      return true;
    }

    return false;
  }

  onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
    this.state = "CLOSED";
  }

  onFailure(): void {
    this.halfOpenInFlight = false;
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold || this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = Date.now();
    }
  }

  /** Pure read-only — no side effects. Transition logic lives in allowRequest(). */
  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
  }
}
