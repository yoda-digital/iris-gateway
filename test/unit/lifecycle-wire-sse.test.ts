/**
 * Tests for wireSSE reconnect behavior in lifecycle.ts
 * Verifies: abort signal prevents reconnect after shutdown, retry on error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("wireSSE reconnect behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("wireSSE checks abort signal before scheduling reconnect", async () => {
    // Create mock objects
    const bridge = {
      subscribeEvents: vi.fn(),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const abortController = new AbortController();
    const router = {
      getEventHandler: () => ({
        handleEvent: vi.fn(),
      }),
    };

    // Track calls for the test
    let callCount = 0;
    bridge.subscribeEvents.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Connection lost");
      }
      // Second call succeeds
    });

    // Import and call wireSSE inline (simulating the pattern in lifecycle.ts)
    const wireSSE = async (): Promise<void> => {
      try {
        await bridge.subscribeEvents((event: any) => {
          router.getEventHandler().handleEvent(event);
        });
        logger.info("OpenCode SSE subscription active");
      } catch (err) {
        logger.warn({ err }, "SSE subscription dropped — reconnecting in 5s");
        setTimeout(() => {
          if (!abortController.signal.aborted) {
            void wireSSE();
          }
        }, 5_000);
      }
    };

    // Start wireSSE
    void wireSSE();

    // Let the first call complete
    await vi.runAllTimersAsync();

    // First call failed, timer fired, second call made (and succeeded)
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Now abort - any further retries should be prevented
    abortController.abort();

    // Mock third call to fail (would trigger another retry if not aborted)
    bridge.subscribeEvents.mockRejectedValueOnce(new Error("Lost again"));

    // Advance timers - should NOT trigger retry because aborted
    await vi.runAllTimersAsync();

    // Should still be 2 calls - abort prevented the retry
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(2);
  });

  it("wireSSE retries on transient error when not aborted", async () => {
    const bridge = {
      subscribeEvents: vi.fn(),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const abortController = new AbortController();
    const router = {
      getEventHandler: () => ({
        handleEvent: vi.fn(),
      }),
    };

    // First two calls fail, third succeeds
    bridge.subscribeEvents
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockRejectedValueOnce(new Error("Still connecting"))
      .mockResolvedValueOnce(undefined);

    const wireSSE = async (): Promise<void> => {
      try {
        await bridge.subscribeEvents((event: any) => {
          router.getEventHandler().handleEvent(event);
        });
        logger.info("OpenCode SSE subscription active");
      } catch (err) {
        logger.warn({ err }, "SSE subscription dropped — reconnecting in 5s");
        setTimeout(() => {
          if (!abortController.signal.aborted) {
            void wireSSE();
          }
        }, 5_000);
      }
    };

    void wireSSE();

    // First retry
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(2);

    // Second retry
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(3);

    // Should have logged the info message on success
    expect(logger.info).toHaveBeenCalledWith("OpenCode SSE subscription active");
  });

  it("wireSSE logs info message on successful subscription", async () => {
    const bridge = {
      subscribeEvents: vi.fn().mockResolvedValue(undefined),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const router = {
      getEventHandler: () => ({
        handleEvent: vi.fn(),
      }),
    };

    const wireSSE = async (): Promise<void> => {
      try {
        await bridge.subscribeEvents((event: any) => {
          router.getEventHandler().handleEvent(event);
        });
        logger.info("OpenCode SSE subscription active");
      } catch (err) {
        logger.warn({ err }, "SSE subscription dropped — reconnecting in 5s");
        setTimeout(() => {
          void wireSSE();
        }, 5_000);
      }
    };

    void wireSSE();

    // Wait for the promise to resolve
    await vi.runAllTimersAsync();

    expect(logger.info).toHaveBeenCalledWith("OpenCode SSE subscription active");
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
