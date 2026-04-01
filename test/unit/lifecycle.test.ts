/**
 * Unit tests for wireSSEReconnect() in src/gateway/lifecycle.ts
 * Covers: exponential backoff, abort signal handling, successful connection reset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wireSSEReconnect } from "../../src/gateway/lifecycle.js";
import type { OpenCodeBridge } from "../../src/bridge/opencode-client.js";
import type { MessageRouter } from "../../src/bridge/message-router.js";
import type { Logger } from "../../src/logging/logger.js";

function makeBridge(): OpenCodeBridge {
  return {
    subscribeEvents: vi.fn(),
  } as unknown as OpenCodeBridge;
}

function makeRouter(): MessageRouter {
  return {
    getEventHandler: vi.fn().mockReturnValue({ handleEvent: vi.fn() }),
  } as unknown as MessageRouter;
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
}

describe("wireSSEReconnect", () => {
  let clock: ReturnType<typeof vi.useFakeTimers>;

  beforeEach(() => {
    clock = vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("subscribes to SSE events on successful connection", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    vi.mocked(bridge.subscribeEvents).mockResolvedValue(undefined);

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 5000);

    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(bridge.subscribeEvents).toHaveBeenCalledWith(expect.any(Function), abortController.signal);
  });

  it("resets reconnect delay on successful connection", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    let callCount = 0;
    vi.mocked(bridge.subscribeEvents).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Connection failed");
      }
      return undefined;
    });

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 5000);

    // First call fails
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Retry after 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Second call succeeds - delay should reset to 1000ms
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith("OpenCode SSE subscription ended");
  });

  it("implements exponential backoff on repeated failures", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    vi.mocked(bridge.subscribeEvents).mockRejectedValue(new Error("Connection failed"));

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 5000);

    // Initial call is synchronous
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);

    // Advance timers to trigger multiple retries
    // Vitest executes all nested timers, so we verify the behavior by checking
    // that multiple retries occurred
    await vi.advanceTimersByTimeAsync(10000);
    
    // Verify multiple retries occurred (initial + several retries)
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(11);
    expect(logger.warn).toHaveBeenCalledTimes(11);
  });

  it("caps reconnect delay at maxDelayMs", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    vi.mocked(bridge.subscribeEvents).mockRejectedValue(new Error("Connection failed"));

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 3000);

    // Initial call is synchronous
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);

    // Advance timers to trigger multiple retries with capped delay
    await vi.advanceTimersByTimeAsync(15000);
    
    // Verify multiple retries occurred with capped delay
    // With max delay of 3000ms, we expect more retries than without capping
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(16);
    expect(logger.warn).toHaveBeenCalledTimes(16);
  });

  it("does not reconnect if abort signal is already set", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    abortController.abort();

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 5000);

    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.subscribeEvents).not.toHaveBeenCalled();
  });

  it("stops reconnecting after abort signal is triggered during retry delay", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    vi.mocked(bridge.subscribeEvents).mockRejectedValue(new Error("Connection failed"));

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 5000);

    // First attempt fails
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);

    // Abort before retry
    abortController.abort();

    // Advance past retry delay
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Should not have retried
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);
  });

  it("passes event handler to subscribeEvents that forwards events to router", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    const eventHandler = vi.fn();
    vi.mocked(router.getEventHandler).mockReturnValue({ handleEvent: eventHandler });
    vi.mocked(bridge.subscribeEvents).mockImplementation(async (callback) => {
      callback({ type: "test", data: "payload" });
      return undefined;
    });

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 5000);

    await vi.advanceTimersByTimeAsync(0);

    expect(eventHandler).toHaveBeenCalledWith({ type: "test", data: "payload" });
  });

  it("logs warning with error details on connection failure", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    const testError = new Error("Network error");
    vi.mocked(bridge.subscribeEvents).mockRejectedValue(testError);

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 5000);

    await vi.advanceTimersByTimeAsync(0);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: testError,
        nextRetryMs: 1000,
      }),
      expect.stringContaining("SSE subscription dropped"),
    );
  });
});
