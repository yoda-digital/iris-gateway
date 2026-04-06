/**
 * Unit tests for wireSSESubscription helper function
 * Issue #315 — extracted phase testing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wireSSESubscription } from "../../src/gateway/lifecycle.js";
import type { OpenCodeBridge } from "../../src/bridge/opencode-client.js";
import type { MessageRouter } from "../../src/bridge/message-router.js";
import type { Logger } from "../../src/logging/logger.js";

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as any;
}

function makeBridge(): OpenCodeBridge {
  return {
    subscribeEvents: vi.fn(),
  } as any;
}

function makeRouter(): MessageRouter {
  return {
    getEventHandler: vi.fn().mockReturnValue({
      handleEvent: vi.fn(),
    }),
  } as any;
}

describe("wireSSESubscription", () => {
  let timers: NodeJS.Timeout[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    timers.forEach(clearTimeout);
    timers = [];
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("calls bridge.subscribeEvents with event handler and abort signal", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    // Make subscribeEvents block forever
    bridge.subscribeEvents = vi.fn().mockImplementation(
      () => new Promise(() => {}),
    );

    wireSSESubscription(bridge, router, abortController, logger);

    // Wait for event loop tick
    await vi.runOnlyPendingTimersAsync();

    expect(bridge.subscribeEvents).toHaveBeenCalledWith(
      expect.any(Function),
      abortController.signal,
    );
  });

  it("does NOT call subscribeEvents if abortController is already aborted", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    abortController.abort();

    wireSSESubscription(bridge, router, abortController, logger);

    await vi.runOnlyPendingTimersAsync();

    expect(bridge.subscribeEvents).not.toHaveBeenCalled();
  });

  it("logs info when SSE subscription ends normally", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    // subscribeEvents resolves immediately (normal end)
    bridge.subscribeEvents = vi.fn().mockResolvedValue(undefined);

    wireSSESubscription(bridge, router, abortController, logger);

    await vi.runAllTimersAsync();

    expect(logger.info).toHaveBeenCalledWith("OpenCode SSE subscription ended");
  });

  it("reconnects with exponential backoff when subscription drops", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    let callCount = 0;
    bridge.subscribeEvents = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.reject(new Error("connection lost"));
      }
      // Third call succeeds and blocks
      return new Promise(() => {});
    });

    wireSSESubscription(bridge, router, abortController, logger);

    // First call fails immediately
    await vi.runOnlyPendingTimersAsync();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: 5000 }),
      expect.stringContaining("SSE subscription dropped"),
    );

    // Advance 5s (first retry delay)
    vi.advanceTimersByTime(5000);
    await vi.runOnlyPendingTimersAsync();

    // Second call fails, delay doubles to 10s
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: 10000 }),
      expect.stringContaining("SSE subscription dropped"),
    );

    // Advance 10s (second retry delay)
    vi.advanceTimersByTime(10000);
    await vi.runOnlyPendingTimersAsync();

    // Third call succeeds (no more warnings)
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(3);
  });

  it("stops reconnecting when abortController is aborted during retry delay", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    // Always fail
    bridge.subscribeEvents = vi.fn().mockRejectedValue(new Error("connection lost"));

    wireSSESubscription(bridge, router, abortController, logger);

    // First call fails
    await vi.runOnlyPendingTimersAsync();
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);

    // Abort during the 5s retry delay
    abortController.abort();

    // Advance past the retry delay
    vi.advanceTimersByTime(5000);
    await vi.runOnlyPendingTimersAsync();

    // Should NOT have retried after abort
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);
  });

  it("does NOT log warning if connection drops after abort signal", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    bridge.subscribeEvents = vi.fn().mockImplementation(async (handler, signal) => {
      // Simulate abort happening during subscription
      abortController.abort();
      throw new Error("aborted");
    });

    wireSSESubscription(bridge, router, abortController, logger);

    await vi.runAllTimersAsync();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("caps retry delay at 30 seconds", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    // Always fail
    bridge.subscribeEvents = vi.fn().mockRejectedValue(new Error("connection lost"));

    wireSSESubscription(bridge, router, abortController, logger);

    // Fail multiple times: 5s → 10s → 20s → 30s (capped)
    const expectedDelays = [5000, 10000, 20000, 30000, 30000];

    for (let i = 0; i < expectedDelays.length; i++) {
      await vi.runOnlyPendingTimersAsync();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ nextRetryMs: expectedDelays[i] }),
        expect.any(String),
      );
      vi.advanceTimersByTime(expectedDelays[i]);
    }
  });

  it("resets retry delay to 5s after successful connection", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    let callCount = 0;
    bridge.subscribeEvents = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call fails
        return Promise.reject(new Error("connection lost"));
      } else if (callCount === 2) {
        // Second call succeeds then fails (simulating a brief connection)
        return Promise.resolve(undefined);
      } else {
        // Third call should use reset delay (5s, not 10s)
        return new Promise(() => {});
      }
    });

    wireSSESubscription(bridge, router, abortController, logger);

    // First call fails → delay = 5s
    await vi.runOnlyPendingTimersAsync();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: 5000 }),
      expect.any(String),
    );

    // Advance 5s and retry
    vi.advanceTimersByTime(5000);
    await vi.runOnlyPendingTimersAsync();

    // Second call succeeds
    expect(logger.info).toHaveBeenCalledWith("OpenCode SSE subscription ended");

    // Auto-retry after normal end should use reset delay (5s)
    // (wireSSE recursively calls itself after successful subscription ends)
    await vi.runOnlyPendingTimersAsync();

    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(3);
  });
});
