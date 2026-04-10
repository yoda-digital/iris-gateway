import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SSE_MAX_RECONNECT_DELAY_MS,
  SSE_RECONNECT_DELAY_MS,
  wireSSEReconnect,
} from "../../src/gateway/sse-wiring.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("wireSSEReconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls bridge.subscribeEvents with the abort signal", async () => {
    const bridge = {
      subscribeEvents: vi.fn().mockResolvedValue(undefined),
    };
    const router = { getEventHandler: () => ({ handleEvent: vi.fn() }) };
    const logger = makeLogger();
    const ac = new AbortController();

    wireSSEReconnect(bridge as any, router as any, logger as any, ac.signal);

    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(bridge.subscribeEvents).toHaveBeenCalledWith(expect.any(Function), ac.signal);
    expect(logger.info).toHaveBeenCalledWith("OpenCode SSE subscription ended");
  });

  it("reconnects with exponential backoff on error", async () => {
    const bridge = {
      subscribeEvents: vi.fn()
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockRejectedValueOnce(new Error("still down"))
        .mockResolvedValueOnce(undefined),
    };
    const router = { getEventHandler: () => ({ handleEvent: vi.fn() }) };
    const logger = makeLogger();
    const ac = new AbortController();

    wireSSEReconnect(bridge as any, router as any, logger as any, ac.signal);

    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: SSE_RECONNECT_DELAY_MS }),
      expect.stringContaining("SSE subscription dropped"),
    );

    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextRetryMs: SSE_RECONNECT_DELAY_MS }),
      expect.stringContaining("SSE subscription dropped"),
    );

    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS * 2);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith("OpenCode SSE subscription ended");
  });

  it("does not reconnect when abort signal is already aborted", async () => {
    const bridge = { subscribeEvents: vi.fn() };
    const router = { getEventHandler: () => ({ handleEvent: vi.fn() }) };
    const logger = makeLogger();
    const ac = new AbortController();
    ac.abort();

    wireSSEReconnect(bridge as any, router as any, logger as any, ac.signal);

    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.subscribeEvents).not.toHaveBeenCalled();
  });

  it("stops reconnecting when aborted during backoff", async () => {
    const bridge = {
      subscribeEvents: vi.fn().mockRejectedValue(new Error("down")),
    };
    const router = { getEventHandler: () => ({ handleEvent: vi.fn() }) };
    const logger = makeLogger();
    const ac = new AbortController();

    wireSSEReconnect(bridge as any, router as any, logger as any, ac.signal);

    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);

    ac.abort();
    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS);
    expect(bridge.subscribeEvents).toHaveBeenCalledTimes(1);
  });

  it("resets delay to base on successful connection", async () => {
    const bridge = {
      subscribeEvents: vi.fn()
        .mockRejectedValueOnce(new Error("fail1"))
        .mockRejectedValueOnce(new Error("fail2"))
        .mockResolvedValueOnce(undefined),
    };
    const router = { getEventHandler: () => ({ handleEvent: vi.fn() }) };
    const logger = makeLogger();
    const ac = new AbortController();

    wireSSEReconnect(bridge as any, router as any, logger as any, ac.signal);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS);
    await vi.advanceTimersByTimeAsync(SSE_RECONNECT_DELAY_MS * 2);

    const warnCalls = logger.warn.mock.calls;
    expect(warnCalls[0][0].nextRetryMs).toBe(SSE_RECONNECT_DELAY_MS);
    expect(warnCalls[1][0].nextRetryMs).toBe(SSE_RECONNECT_DELAY_MS);
  });

  it("caps reconnect delay at SSE_MAX_RECONNECT_DELAY_MS", async () => {
    const bridge = {
      subscribeEvents: vi.fn().mockRejectedValue(new Error("down")),
    };
    const router = { getEventHandler: () => ({ handleEvent: vi.fn() }) };
    const logger = makeLogger();
    const ac = new AbortController();

    wireSSEReconnect(bridge as any, router as any, logger as any, ac.signal);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(20_000);

    const lastWarn = logger.warn.mock.calls[logger.warn.mock.calls.length - 1];
    expect(lastWarn[0].nextRetryMs).toBeLessThanOrEqual(SSE_MAX_RECONNECT_DELAY_MS);

    ac.abort();
  });

  it("forwards SSE events to router event handler", async () => {
    const handleEvent = vi.fn();
    const fakeEvent = { type: "message", data: "hello" };
    const bridge = {
      subscribeEvents: vi.fn().mockImplementation(async (cb: (event: unknown) => void) => {
        cb(fakeEvent);
      }),
    };
    const router = { getEventHandler: () => ({ handleEvent }) };
    const logger = makeLogger();
    const ac = new AbortController();

    wireSSEReconnect(bridge as any, router as any, logger as any, ac.signal);

    await vi.advanceTimersByTimeAsync(0);
    expect(handleEvent).toHaveBeenCalledWith(fakeEvent);
  });
});
