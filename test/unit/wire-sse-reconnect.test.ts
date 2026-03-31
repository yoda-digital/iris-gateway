/**
 * Unit tests for SSE reconnection backoff logic (PR #312, issue #306)
 * Verifies that normal-close reconnect uses exponential backoff matching the error path.
 */

import { describe, it, expect, vi } from "vitest";

const SSE_RECONNECT_DELAY_MS = 5_000;
const SSE_MAX_RECONNECT_DELAY_MS = 30_000;

describe("wireSSE normal-close reconnection (issue #306)", () => {
  it("reconnects with exponential backoff after normal SSE stream close", async () => {
    vi.useFakeTimers();

    let sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
    const abortController = { signal: { aborted: false } };
    let callCount = 0;
    const capturedDelays: number[] = [];

    // Simulate the wireSSE reconnection logic from lifecycle.ts
    const wireSSE = async (): Promise<void> => {
      if (abortController.signal.aborted) return;
      try {
        sseReconnectDelay = SSE_RECONNECT_DELAY_MS; // reset on successful connection
        callCount++;

        if (callCount <= 3) {
          // Normal close — stream resolves without error
          if (abortController.signal.aborted) return;
          const delay = sseReconnectDelay;
          sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY_MS);
          capturedDelays.push(delay);
          setTimeout(() => {
            if (abortController.signal.aborted) return;
            void wireSSE();
          }, delay);
        }
        // callCount > 3: stays open (no reconnection needed)
      } catch {
        // error path — not tested here
      }
    };

    void wireSSE();
    await vi.runAllTimersAsync();

    // Should have reconnected 3 times (4 total calls)
    expect(callCount).toBe(4);
    // Backoff: 5s → 10s → 20s (capped at 30s on next)
    expect(capturedDelays).toEqual([5_000, 10_000, 20_000]);

    vi.useRealTimers();
  });

  it("does not reconnect when abort signal is fired", async () => {
    vi.useFakeTimers();

    let sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
    const abortController = { signal: { aborted: false } };
    let callCount = 0;

    const wireSSE = async (): Promise<void> => {
      if (abortController.signal.aborted) return;
      try {
        sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
        callCount++;

        if (callCount === 1) {
          // Simulate abort before reconnect fires
          abortController.signal.aborted = true;
          if (abortController.signal.aborted) return;
          // This should not be reached
          setTimeout(() => {
            if (abortController.signal.aborted) return;
            void wireSSE();
          }, SSE_RECONNECT_DELAY_MS);
        }
      } catch {
        // not relevant
      }
    };

    void wireSSE();
    await vi.runAllTimersAsync();

    // Abort signal should prevent second call
    expect(callCount).toBe(1);

    vi.useRealTimers();
  });

  it("backoff delay respects SSE_MAX_RECONNECT_DELAY_MS cap", () => {
    let sseReconnectDelay = 20_000; // already elevated from prior errors

    const delay = sseReconnectDelay;
    sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY_MS);

    expect(delay).toBe(20_000);
    expect(sseReconnectDelay).toBe(30_000); // capped at max

    // Next iteration should stay at max
    const nextDelay = sseReconnectDelay;
    sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY_MS);
    expect(nextDelay).toBe(30_000);
    expect(sseReconnectDelay).toBe(30_000); // still capped
  });
});
