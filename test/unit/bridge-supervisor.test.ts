import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BridgeSupervisor } from "../../src/bridge/supervisor.js";
import type { Logger } from "../../src/logging/logger.js";

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function makeSupervisor(opts: {
  checkHealth?: () => Promise<boolean>;
  doStart?: () => Promise<void>;
  teardown?: () => void;
  onMaxRestartsExceeded?: () => void;
  maxRestarts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  healthIntervalMs?: number;
} = {}) {
  const logger = makeLogger();
  const checkHealthFn = opts.checkHealth ?? vi.fn().mockResolvedValue(true);
  const doStartFn = opts.doStart ?? vi.fn().mockResolvedValue(undefined);
  const teardownFn = opts.teardown ?? vi.fn();
  const sup = new BridgeSupervisor(logger, checkHealthFn, doStartFn, teardownFn, {
    maxRestarts: opts.maxRestarts ?? 3,
    initialBackoffMs: opts.initialBackoffMs ?? 100,
    maxBackoffMs: opts.maxBackoffMs ?? 1000,
    healthIntervalMs: opts.healthIntervalMs ?? 50,
    onMaxRestartsExceeded: opts.onMaxRestartsExceeded,
  });
  return { sup, logger, checkHealthFn, doStartFn, teardownFn };
}

describe("BridgeSupervisor", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  // ── constructor / defaults ──

  it("initializes with zero restart attempts", () => {
    const { sup } = makeSupervisor();
    expect(sup.restartAttempts).toBe(0);
    expect(sup.pendingQueue).toHaveLength(0);
  });

  it("circuitBreaker starts CLOSED", () => {
    const { sup } = makeSupervisor();
    expect(sup.circuitBreaker.getState()).toBe("CLOSED");
  });

  // ── startHealthMonitor / stopHealthMonitor ──

  it("startHealthMonitor sets up interval", () => {
    const { sup } = makeSupervisor();
    sup.startHealthMonitor();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    sup.stopHealthMonitor();
  });

  it("startHealthMonitor is idempotent — second call is a no-op", () => {
    const { sup } = makeSupervisor();
    sup.startHealthMonitor();
    const count = vi.getTimerCount();
    sup.startHealthMonitor();
    expect(vi.getTimerCount()).toBe(count);
    sup.stopHealthMonitor();
  });

  it("stopHealthMonitor clears interval", () => {
    const { sup } = makeSupervisor();
    sup.startHealthMonitor();
    sup.stopHealthMonitor();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stopHealthMonitor is safe when not started", () => {
    const { sup } = makeSupervisor();
    expect(() => sup.stopHealthMonitor()).not.toThrow();
  });

  // ── health tick — healthy ──

  it("health tick: healthy + circuit already CLOSED → no action", async () => {
    const checkHealth = vi.fn().mockResolvedValue(true);
    const { sup } = makeSupervisor({ checkHealth });
    sup.startHealthMonitor();
    await vi.advanceTimersByTimeAsync(60);
    sup.stopHealthMonitor();
    // circuit stays CLOSED, no drainQueue needed
    expect(sup.circuitBreaker.getState()).toBe("CLOSED");
  });

  it("health tick: healthy after OPEN → closes circuit and resets restartAttempts", async () => {
    const checkHealth = vi.fn().mockResolvedValue(true);
    const { sup } = makeSupervisor({ checkHealth });
    // Force circuit open
    sup.circuitBreaker.onFailure();
    sup.circuitBreaker.onFailure();
    sup.circuitBreaker.onFailure();
    // Now health tick runs healthy
    sup.startHealthMonitor();
    await vi.advanceTimersByTimeAsync(60);
    sup.stopHealthMonitor();
    expect(sup.circuitBreaker.getState()).toBe("CLOSED");
    expect(sup.restartAttempts).toBe(0);
  });

  it("health tick: healthy → drains queue", async () => {
    const checkHealth = vi.fn().mockResolvedValue(true);
    const { sup } = makeSupervisor({ checkHealth });
    sup.circuitBreaker.onFailure();
    sup.circuitBreaker.onFailure();
    sup.circuitBreaker.onFailure();
    const resume = vi.fn();
    sup.pendingQueue.push(resume);
    sup.startHealthMonitor();
    await vi.advanceTimersByTimeAsync(60);
    sup.stopHealthMonitor();
    expect(resume).toHaveBeenCalled();
    expect(sup.pendingQueue).toHaveLength(0);
  });

  it("health tick: unhealthy → triggers scheduleRestart", async () => {
    const checkHealth = vi.fn().mockResolvedValue(false);
    const { sup } = makeSupervisor({ checkHealth });
    sup.startHealthMonitor();
    await vi.advanceTimersByTimeAsync(60);
    sup.stopHealthMonitor();
    expect(sup.restartAttempts).toBeGreaterThan(0);
  });

  // ── scheduleRestart ──

  it("scheduleRestart: exponential backoff — attempt 0 fires at initialBackoffMs", async () => {
    const doStart = vi.fn().mockResolvedValue(undefined);
    const checkHealth = vi.fn().mockResolvedValue(true); // healthy after restart
    const { sup, logger } = makeSupervisor({ doStart, checkHealth, maxRestarts: 3, initialBackoffMs: 100 });
    sup.scheduleRestart(0);
    // should NOT have fired yet
    await vi.advanceTimersByTimeAsync(99);
    expect(doStart).not.toHaveBeenCalled();
    // fires at exactly 100ms
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(doStart).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ backoffMs: 100 }),
      expect.any(String)
    );
  });

  it("scheduleRestart: attempt 1 has doubled backoff (200ms)", async () => {
    const doStart = vi.fn().mockResolvedValue(undefined);
    const checkHealth = vi.fn().mockResolvedValue(true);
    const { sup, logger } = makeSupervisor({ doStart, checkHealth, maxRestarts: 3, initialBackoffMs: 100 });
    // Start at attempt 1 directly
    sup.scheduleRestart(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(doStart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(doStart).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ backoffMs: 200 }),
      expect.any(String)
    );
  });

  it("scheduleRestart: maxBackoffMs caps the backoff", async () => {
    const doStart = vi.fn().mockResolvedValue(undefined);
    const checkHealth = vi.fn().mockResolvedValue(false);
    const { sup } = makeSupervisor({ doStart, checkHealth, maxRestarts: 5, initialBackoffMs: 100, maxBackoffMs: 150 });
    sup.scheduleRestart(3); // 100 * 2^3 = 800 → capped at 150
    await vi.advanceTimersByTimeAsync(150);
    expect(doStart).toHaveBeenCalledTimes(1);
  });

  it("scheduleRestart: max restarts exceeded calls onMaxRestartsExceeded", () => {
    const onMaxRestartsExceeded = vi.fn();
    const { sup } = makeSupervisor({ maxRestarts: 2, onMaxRestartsExceeded });
    sup.scheduleRestart(2); // attempt >= maxRestarts
    expect(onMaxRestartsExceeded).toHaveBeenCalled();
  });

  it("scheduleRestart: max restarts exceeded logs error", () => {
    const { sup, logger } = makeSupervisor({ maxRestarts: 2 });
    sup.scheduleRestart(2);
    expect(logger.error).toHaveBeenCalled();
  });

  it("scheduleRestart: is idempotent while already restarting", async () => {
    const doStart = vi.fn().mockResolvedValue(undefined);
    const checkHealth = vi.fn().mockResolvedValue(true);
    const { sup } = makeSupervisor({ doStart, checkHealth, initialBackoffMs: 100 });
    sup.scheduleRestart(0);
    sup.scheduleRestart(0); // second call while _isRestarting=true
    await vi.advanceTimersByTimeAsync(100);
    expect(doStart).toHaveBeenCalledTimes(1); // only one restart
  });

  it("scheduleRestart: restart succeeds + health ok → closes circuit, resets attempts, drains queue", async () => {
    const checkHealth = vi.fn().mockResolvedValue(true);
    const doStart = vi.fn().mockResolvedValue(undefined);
    const teardown = vi.fn();
    const resume = vi.fn();
    const { sup } = makeSupervisor({ checkHealth, doStart, teardown, initialBackoffMs: 50 });
    sup.pendingQueue.push(resume);
    sup.circuitBreaker.onFailure();
    sup.circuitBreaker.onFailure();
    sup.circuitBreaker.onFailure();
    sup.scheduleRestart(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(teardown).toHaveBeenCalled();
    expect(doStart).toHaveBeenCalled();
    expect(sup.circuitBreaker.getState()).toBe("CLOSED");
    expect(sup.restartAttempts).toBe(0);
    expect(resume).toHaveBeenCalled();
  });

  it("scheduleRestart: restart succeeds but health still failing → reschedules retry", async () => {
    const checkHealth = vi.fn().mockResolvedValue(false);
    const doStart = vi.fn().mockResolvedValue(undefined);
    const { sup, logger } = makeSupervisor({ checkHealth, doStart, maxRestarts: 3, initialBackoffMs: 50 });
    sup.scheduleRestart(0);
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(doStart).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/did not restore health/));
    // source bug fixed: nextAttempt set after finally resets _isRestarting
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(doStart).toHaveBeenCalledTimes(2);
  });

  it("scheduleRestart: doStartFn throws → logs error and is restartable again", async () => {
    const doStart = vi.fn().mockRejectedValue(new Error("start failed"));
    const checkHealth = vi.fn().mockResolvedValue(true);
    const { sup, logger } = makeSupervisor({ doStart, checkHealth, maxRestarts: 3, initialBackoffMs: 50 });
    sup.scheduleRestart(0);
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringMatching(/restart failed/)
    );
    // _isRestarting reset via finally — attempt 1 auto-rescheduled
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(doStart).toHaveBeenCalledTimes(2);
  });

  // ── drainQueue ──

  it("drainQueue: calls all pending callbacks and empties queue", () => {
    const { sup } = makeSupervisor();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    sup.pendingQueue.push(cb1, cb2);
    sup.drainQueue();
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    expect(sup.pendingQueue).toHaveLength(0);
  });

  it("drainQueue: does not throw if a callback throws", () => {
    const { sup } = makeSupervisor();
    sup.pendingQueue.push(() => { throw new Error("oops"); });
    expect(() => sup.drainQueue()).not.toThrow();
  });

  it("drainQueue: subsequent callbacks still fire when first throws", () => {
    const { sup } = makeSupervisor();
    const cb2 = vi.fn();
    const cb3 = vi.fn();
    sup.pendingQueue.push(() => { throw new Error("first fails"); }, cb2, cb3);
    sup.drainQueue();
    expect(cb2).toHaveBeenCalled();
    expect(cb3).toHaveBeenCalled();
  });

  it("drainQueue: no-op on empty queue", () => {
    const { sup, logger } = makeSupervisor();
    expect(() => sup.drainQueue()).not.toThrow();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ count: 0 }), expect.any(String));
  });

  // ── waitForCircuit ──

  it("waitForCircuit: returns true when circuit CLOSED", async () => {
    const { sup } = makeSupervisor();
    expect(await sup.waitForCircuit()).toBe(true);
  });

  it("waitForCircuit: returns false when queue is full", async () => {
    const { sup } = makeSupervisor({ maxRestarts: 1 });
    // Force circuit open
    for (let i = 0; i < 10; i++) sup.circuitBreaker.onFailure();
    // Fill queue to maxQueueSize (default 50 but we set lower via opts... use default)
    for (let i = 0; i < 50; i++) sup.pendingQueue.push(vi.fn());
    const result = await sup.waitForCircuit();
    expect(result).toBe(false);
  });

  it("waitForCircuit: queues call and resolves after drainQueue", async () => {
    const { sup } = makeSupervisor();
    for (let i = 0; i < 5; i++) sup.circuitBreaker.onFailure();
    const promise = sup.waitForCircuit();
    expect(sup.pendingQueue).toHaveLength(1);
    sup.drainQueue();
    // After drain, circuit still open so allowRequest may be false
    await expect(promise).resolves.toBe(false); // circuit still OPEN after drain
  });
});
