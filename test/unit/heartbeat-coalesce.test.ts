import { describe, it, expect, vi, afterEach } from "vitest";
import { HeartbeatCoalescer } from "../../src/heartbeat/coalesce.js";

describe("HeartbeatCoalescer", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("debounces rapid requests", async () => {
    vi.useFakeTimers();
    const runner = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatCoalescer({ coalesceMs: 250, retryMs: 1000, getQueueSize: () => 0 });

    coalescer.requestRun(runner);
    coalescer.requestRun(runner);
    coalescer.requestRun(runner);

    vi.advanceTimersByTime(250);
    await vi.runAllTimersAsync();

    expect(runner).toHaveBeenCalledOnce();
  });

  it("defers when queue is busy", async () => {
    vi.useFakeTimers();
    let queueSize = 1;
    const runner = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatCoalescer({
      coalesceMs: 250,
      retryMs: 1000,
      getQueueSize: () => queueSize,
    });

    coalescer.requestRun(runner);
    await vi.advanceTimersByTimeAsync(250);

    expect(runner).not.toHaveBeenCalled();

    queueSize = 0;
    await vi.advanceTimersByTimeAsync(1000);

    expect(runner).toHaveBeenCalledOnce();
  });

  it("runs immediately when queue is empty", async () => {
    vi.useFakeTimers();
    const runner = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatCoalescer({ coalesceMs: 250, retryMs: 1000, getQueueSize: () => 0 });

    coalescer.requestRun(runner);
    vi.advanceTimersByTime(250);
    await vi.runAllTimersAsync();

    expect(runner).toHaveBeenCalledOnce();
  });

  it("cancels pending debounce on dispose", () => {
    vi.useFakeTimers();
    const runner = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatCoalescer({ coalesceMs: 250, retryMs: 1000, getQueueSize: () => 0 });

    coalescer.requestRun(runner);
    coalescer.dispose();
    vi.advanceTimersByTime(500);

    expect(runner).not.toHaveBeenCalled();
  });
});
