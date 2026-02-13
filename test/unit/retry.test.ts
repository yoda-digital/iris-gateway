import { describe, it, expect } from "vitest";
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

  it("respects abort signal", async () => {
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
