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

  it("resets reconnect delay to initialDelayMs after successful reconnect", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    // Simulate: fail → fail (backoff accumulates) → succeed (delay resets)
    // A second wireSSEReconnect call confirms the delay was reset.
    let callCount = 0;
    vi.mocked(bridge.subscribeEvents).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("first failure");
      if (callCount === 2) throw new Error("second failure");
      // call 3: success — resolves normally, delay resets
      return undefined;
    });

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 5000);

    // call 1 fails — delay used = 1000ms, backoff accumulates to 2000ms
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toMatchObject({ nextRetryMs: 1000 });

    // call 2 fires after 1000ms, fails — delay used = 2000ms, backoff accumulates to 4000ms
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.warn).mock.calls[1][0]).toMatchObject({ nextRetryMs: 2000 });

    // call 3 fires after 2000ms, succeeds — delay resets to 1000ms
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith("OpenCode SSE subscription ended");

    // Confirm reset: spawn a second reconnector with same params; first failure
    // should again use initialDelayMs (1000ms) not the accumulated 4000ms.
    const bridge2 = makeBridge();
    vi.mocked(bridge2.subscribeEvents).mockRejectedValue(new Error("new drop"));
    wireSSEReconnect(bridge2, router, abortController, logger, 1000, 5000);
    await vi.advanceTimersByTimeAsync(0);
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    expect(warnCalls[warnCalls.length - 1][0]).toMatchObject({ nextRetryMs: 1000 });

    abortController.abort();
  });

  it("implements exponential backoff on repeated failures", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    vi.mocked(bridge.subscribeEvents).mockRejectedValue(new Error("Connection failed"));

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 16000);

    // call 1 fails immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toMatchObject({ nextRetryMs: 1000 });

    // call 2 after 1000ms delay — backoff doubles to 2000ms
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.warn).mock.calls[1][0]).toMatchObject({ nextRetryMs: 2000 });

    // call 3 after 2000ms delay — backoff doubles to 4000ms
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logger.warn).mock.calls[2][0]).toMatchObject({ nextRetryMs: 4000 });

    abortController.abort();
  });

  it("caps reconnect delay at maxDelayMs", async () => {
    const bridge = makeBridge();
    const router = makeRouter();
    const abortController = new AbortController();
    const logger = makeLogger();

    vi.mocked(bridge.subscribeEvents).mockRejectedValue(new Error("Connection failed"));

    wireSSEReconnect(bridge, router, abortController, logger, 1000, 3000);

    // call 1: delay = 1000ms → doubles to 2000ms
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toMatchObject({ nextRetryMs: 1000 });

    // call 2: delay = 2000ms → doubles to 4000ms, capped at 3000ms
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(logger.warn).mock.calls[1][0]).toMatchObject({ nextRetryMs: 2000 });

    // call 3: delay = 3000ms (capped) → stays at 3000ms
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(logger.warn).mock.calls[2][0]).toMatchObject({ nextRetryMs: 3000 });

    // call 4: delay = 3000ms (still capped)
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(logger.warn).mock.calls[3][0]).toMatchObject({ nextRetryMs: 3000 });

    abortController.abort();
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
