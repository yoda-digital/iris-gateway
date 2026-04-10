import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSSEReconnect,
  SSE_RECONNECT_DELAY_MS,
  SSE_MAX_RECONNECT_DELAY_MS,
} from "../../src/gateway/sse-reconnect.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn() };
}

describe("wireSSE exponential backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("first SSE drop uses SSE_RECONNECT_DELAY_MS (5s) delay", async () => {
    const abortController = new AbortController();
    const subscribeEvents = vi.fn()
      .mockRejectedValueOnce(new Error("SSE drop"))
      .mockImplementation(() => new Promise(() => {}));
    const logger = makeLogger();

    const wireSSE = createSSEReconnect({
      bridge: { subscribeEvents },
      eventHandler: { handleEvent: vi.fn() },
      logger: logger as any,
      signal: abortController.signal,
    });

    void wireSSE();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: SSE_RECONNECT_DELAY_MS }),
      expect.stringContaining(`${SSE_RECONNECT_DELAY_MS}ms`),
    );
    expect(subscribeEvents).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS);
    expect(subscribeEvents).toHaveBeenCalledTimes(2);

    abortController.abort();
  });

  it("second consecutive SSE drop retries with the base delay", async () => {
    const abortController = new AbortController();
    const subscribeEvents = vi.fn()
      .mockRejectedValueOnce(new Error("SSE drop 1"))
      .mockRejectedValueOnce(new Error("SSE drop 2"))
      .mockImplementation(() => new Promise(() => {}));
    const logger = makeLogger();

    const wireSSE = createSSEReconnect({
      bridge: { subscribeEvents },
      eventHandler: { handleEvent: vi.fn() },
      logger: logger as any,
      signal: abortController.signal,
    });

    void wireSSE();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: SSE_RECONNECT_DELAY_MS }),
      expect.any(String),
    );

    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextRetryMs: SSE_RECONNECT_DELAY_MS }),
      expect.stringContaining(`${SSE_RECONNECT_DELAY_MS}ms`),
    );

    abortController.abort();
  });

  it("delay resets to SSE_RECONNECT_DELAY_MS after a successful reconnect", async () => {
    const abortController = new AbortController();
    const logger = makeLogger();

    let callCount = 0;
    const subscribeEvents = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("SSE drop 1");
      if (callCount === 2) return;
      if (callCount === 3) throw new Error("SSE drop after reset");
      return new Promise(() => {});
    });

    const wireSSE = createSSEReconnect({
      bridge: { subscribeEvents },
      eventHandler: { handleEvent: vi.fn() },
      logger: logger as any,
      signal: abortController.signal,
    });

    void wireSSE();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: SSE_RECONNECT_DELAY_MS }),
      expect.any(String),
    );

    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS);
    await vi.advanceTimersByTimeAsync(0);

    void wireSSE();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextRetryMs: SSE_RECONNECT_DELAY_MS }),
      expect.stringContaining(`${SSE_RECONNECT_DELAY_MS}ms`),
    );

    abortController.abort();
  });

  it("no reconnect scheduled when signal.aborted before retry", async () => {
    const abortController = new AbortController();
    const subscribeEvents = vi.fn()
      .mockRejectedValueOnce(new Error("SSE drop"));
    const logger = makeLogger();

    const wireSSE = createSSEReconnect({
      bridge: { subscribeEvents },
      eventHandler: { handleEvent: vi.fn() },
      logger: logger as any,
      signal: abortController.signal,
    });

    void wireSSE();
    await vi.advanceTimersByTimeAsync(0);

    abortController.abort();
    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS);

    expect(subscribeEvents).toHaveBeenCalledTimes(1);
  });

  it("reconnect callback is a no-op if signal aborted inside setTimeout", async () => {
    const abortController = new AbortController();
    const subscribeEvents = vi.fn()
      .mockRejectedValueOnce(new Error("SSE drop"))
      .mockImplementation(() => new Promise(() => {}));
    const logger = makeLogger();

    const wireSSE = createSSEReconnect({
      bridge: { subscribeEvents },
      eventHandler: { handleEvent: vi.fn() },
      logger: logger as any,
      signal: abortController.signal,
    });

    void wireSSE();
    await vi.advanceTimersByTimeAsync(0);

    expect(subscribeEvents).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    abortController.abort();
    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS);

    expect(subscribeEvents).toHaveBeenCalledTimes(1);
  });

  it("signal.aborted before first call returns immediately", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const subscribeEvents = vi.fn();
    const logger = makeLogger();

    const wireSSE = createSSEReconnect({
      bridge: { subscribeEvents },
      eventHandler: { handleEvent: vi.fn() },
      logger: logger as any,
      signal: abortController.signal,
    });

    await wireSSE();

    expect(subscribeEvents).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("retry delay remains at the base delay across repeated drops", async () => {
    const abortController = new AbortController();
    const logger = makeLogger();
    const subscribeEvents = vi.fn()
      .mockRejectedValueOnce(new Error("drop 1"))
      .mockRejectedValueOnce(new Error("drop 2"))
      .mockRejectedValueOnce(new Error("drop 3"))
      .mockRejectedValueOnce(new Error("drop 4"))
      .mockImplementation(() => new Promise(() => {}));

    const wireSSE = createSSEReconnect({
      bridge: { subscribeEvents },
      eventHandler: { handleEvent: vi.fn() },
      logger: logger as any,
      signal: abortController.signal,
    });

    void wireSSE();

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS * 2);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS * 4);

    await vi.advanceTimersByTimeAsync(0);

    const warnCalls = logger.warn.mock.calls;
    const lastWarnMeta = warnCalls[warnCalls.length - 1][0];
    expect(lastWarnMeta.nextRetryMs).toBe(SSE_RECONNECT_DELAY_MS);

    abortController.abort();
  });

  it("catch branch early-returns when signal is aborted during subscribeEvents", async () => {
    const abortController = new AbortController();
    const subscribeEvents = vi.fn().mockImplementation(async () => {
      abortController.abort();
      throw new Error("SSE drop");
    });
    const logger = makeLogger();

    const wireSSE = createSSEReconnect({
      bridge: { subscribeEvents },
      eventHandler: { handleEvent: vi.fn() },
      logger: logger as any,
      signal: abortController.signal,
    });

    await wireSSE();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
  });
});
