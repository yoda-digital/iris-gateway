import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CircuitBreaker } from "../../src/bridge/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 100 });
    vi.useFakeTimers();
  });

  afterEach(() => { vi.useRealTimers(); });

  it("starts CLOSED and allows requests", () => {
    expect(cb.getState()).toBe("CLOSED");
    expect(cb.allowRequest()).toBe(true);
  });

  it("opens after failureThreshold consecutive failures", () => {
    cb.onFailure(); cb.onFailure();
    expect(cb.getState()).toBe("CLOSED");
    cb.onFailure();
    expect(cb.getState()).toBe("OPEN");
    expect(cb.allowRequest()).toBe(false);
  });

  it("transitions to HALF_OPEN after recoveryTimeoutMs", () => {
    cb.onFailure(); cb.onFailure(); cb.onFailure();
    vi.advanceTimersByTime(101);
    expect(cb.getState()).toBe("HALF_OPEN");
  });

  it("allows exactly one probe in HALF_OPEN", () => {
    cb.onFailure(); cb.onFailure(); cb.onFailure();
    vi.advanceTimersByTime(101);
    expect(cb.allowRequest()).toBe(true);
    expect(cb.allowRequest()).toBe(false);
  });

  it("closes on success from HALF_OPEN", () => {
    cb.onFailure(); cb.onFailure(); cb.onFailure();
    vi.advanceTimersByTime(101);
    cb.allowRequest(); cb.onSuccess();
    expect(cb.getState()).toBe("CLOSED");
  });

  it("re-opens on failure from HALF_OPEN", () => {
    cb.onFailure(); cb.onFailure(); cb.onFailure();
    vi.advanceTimersByTime(101);
    cb.allowRequest(); cb.onFailure();
    expect(cb.getState()).toBe("OPEN");
  });

  it("has a default unavailableMessage", () => {
    expect(cb.unavailableMessage).toMatch(/temporarily unavailable/i);
  });

  it("getState() is read-only — does not reset halfOpenInFlight while probe is in flight", () => {
    cb.onFailure(); cb.onFailure(); cb.onFailure();
    vi.advanceTimersByTime(101);
    expect(cb.allowRequest()).toBe(true);  // probe in flight
    expect(cb.allowRequest()).toBe(false); // second request blocked
    cb.getState();                         // must not reset halfOpenInFlight
    expect(cb.allowRequest()).toBe(false); // still blocked after getState()
  });
});
