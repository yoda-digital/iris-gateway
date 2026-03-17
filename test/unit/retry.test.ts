import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retry } from "../../src/utils/retry.js";

describe("retry", () => {
  it("returns on first success", async () => {
    const result = await retry(async () => "ok");
    expect(result).toBe("ok");
  });

  it("retries on failure then succeeds", async () => {
    let attempt = 0;
    const result = await retry(
      async () => {
        attempt++;
        if (attempt < 3) throw new Error("fail");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 10 },
    );
    expect(result).toBe("ok");
    expect(attempt).toBe(3);
  });

  it("throws after max attempts", async () => {
    await expect(
      retry(
        async () => {
          throw new Error("always fails");
        },
        { maxAttempts: 2, baseDelayMs: 10 },
      ),
    ).rejects.toThrow("always fails");
  });

  it("respects abort signal pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      retry(
        async () => {
          throw new Error("fail");
        },
        { maxAttempts: 5, baseDelayMs: 10, signal: controller.signal },
      ),
    ).rejects.toThrow();
  });

  it("passes attempt number to function", async () => {
    const attempts: number[] = [];
    await retry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 2) throw new Error("fail");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 10 },
    );
    expect(attempts).toEqual([0, 1, 2]);
  });
});

describe("retry — fake timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("succeeds on first attempt with no delay", async () => {
    const fn = vi.fn().mockResolvedValue("first");
    const result = await retry(fn);
    expect(result).toBe("first");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(0);
  });

  it("retries with exponential backoff and succeeds on Nth attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const p = retry(fn, { maxAttempts: 5, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("exhausts all maxAttempts and throws last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    // Attach rejection handler before running timers to avoid unhandled rejection
    const assertion = expect(
      retry(fn, { maxAttempts: 4, baseDelayMs: 100 }),
    ).rejects.toThrow("always fails");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("respects custom maxAttempts option", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const assertion = expect(
      retry(fn, { maxAttempts: 6, baseDelayMs: 10 }),
    ).rejects.toThrow("fail");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(6);
  });

  it("respects maxDelayMs cap", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    // With maxDelayMs == baseDelayMs the exponential growth is always capped
    const p = retry(fn, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 500 });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("aborts mid-retry when AbortSignal fires during delay", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const p = retry(fn, { signal: controller.signal, maxAttempts: 5, baseDelayMs: 10_000 });

    // Let the first attempt run and fail so the delay setTimeout is registered
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Abort fires synchronously → rejects the delay promise immediately
    controller.abort(new Error("aborted mid-retry"));

    await expect(p).rejects.toThrow("aborted mid-retry");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("custom baseDelayMs controls wait duration", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("done");

    // Math.random() = 0.5 → delay = min(200 * 2^0, 10000) * 0.75 = 150ms
    const p = retry(fn, { baseDelayMs: 200, maxAttempts: 2 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await p;

    expect(result).toBe("done");
  });
});
