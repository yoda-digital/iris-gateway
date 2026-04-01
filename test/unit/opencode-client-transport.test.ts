import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@opencode-ai/sdk", () => ({
  createOpencode: vi.fn(),
  createOpencodeClient: vi.fn(),
}));

vi.mock("../../src/gateway/metrics.js", () => ({
  metrics: {
    queueDepth: { set: vi.fn() },
  },
}));

import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
import { OpenCodeBridge } from "../../src/bridge/opencode-client.js";
import type { OpenCodeConfig } from "../../src/config/types.js";
import type { Logger } from "../../src/logging/logger.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function makeConfig(overrides: Partial<OpenCodeConfig> = {}): OpenCodeConfig {
  return {
    autoSpawn: false,
    hostname: "127.0.0.1",
    port: 4096,
    projectDir: "/tmp/test-project",
    ...overrides,
  };
}

function makeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, fatal: noop,
    child: () => makeLogger(),
  } as unknown as Logger;
}

/** Inject a fake client directly into a bridge instance (bypasses start()). */
function injectClient(bridge: OpenCodeBridge, client: Record<string, unknown>): void {
  (bridge as any).client = client;
}

/** Build a minimal mock client; session.messages returns the given list. */
function makeMockClient(messages: Array<{ role: string; text: string; hasParts: boolean }> = []) {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: {} }),
      messages: vi.fn().mockResolvedValue({
        data: messages.map(m => ({
          info: { role: m.role },
          parts: m.hasParts ? [{ type: "text", text: m.text }] : [],
        })),
      }),
      create: vi.fn(),
      prompt: vi.fn(),
      abort: vi.fn(),
      delete: vi.fn(),
    },
    event: { subscribe: vi.fn() },
  };
}

/* ── Tests ───────────────────────────────────────────────────────── */

describe("OpenCodeBridge — transport selection and circuit breaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.mocked(createOpencodeClient).mockReturnValue({} as any);
    vi.mocked(createOpencode).mockResolvedValue({
      client: {} as any,
      server: { url: "http://localhost:4096", close: vi.fn() },
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /* ── Transport selection ──────────────────────────────────────── */

  describe("HTTP transport selection (autoSpawn flag)", () => {
    it("uses createOpencodeClient when autoSpawn is false", async () => {
      const bridge = new OpenCodeBridge(makeConfig({ autoSpawn: false }), makeLogger());
      await (bridge as any)._doStart();

      expect(createOpencodeClient).toHaveBeenCalledOnce();
      expect(createOpencode).not.toHaveBeenCalled();
    });

    it("uses createOpencode when autoSpawn is true", async () => {
      const bridge = new OpenCodeBridge(makeConfig({ autoSpawn: true }), makeLogger());
      await (bridge as any)._doStart();

      expect(createOpencode).toHaveBeenCalledOnce();
      expect(createOpencodeClient).not.toHaveBeenCalled();
    });

    it("autoSpawn: false leaves serverHandle null", async () => {
      const bridge = new OpenCodeBridge(makeConfig({ autoSpawn: false }), makeLogger());
      await (bridge as any)._doStart();

      expect((bridge as any).serverHandle).toBeNull();
      expect((bridge as any).client).not.toBeNull();
    });

    it("autoSpawn: true sets both client and serverHandle", async () => {
      const bridge = new OpenCodeBridge(makeConfig({ autoSpawn: true }), makeLogger());
      await (bridge as any)._doStart();

      expect((bridge as any).serverHandle).not.toBeNull();
      expect((bridge as any).client).not.toBeNull();
    });

    it("HTTP transport success — sendAndWait returns response text", async () => {
      const bridge = new OpenCodeBridge(makeConfig({ autoSpawn: false }), makeLogger());
      (bridge as any)._sendAndWaitInternal = vi.fn().mockResolvedValue("hello from AI");
      injectClient(bridge, makeMockClient());

      const result = await bridge.sendAndWait("session-1", "ping");
      expect(result).toBe("hello from AI");
    });
  });

  /* ── Timeout handling ─────────────────────────────────────────── */

  describe("HTTP transport timeout", () => {
    it("returns empty string when timeoutMs elapses before a response arrives", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const client = makeMockClient([]);
      injectClient(bridge, client);

      // Always return no new messages → poll loop exhausts the deadline
      client.session.messages.mockResolvedValue({ data: [] });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 300, 100);
      await vi.advanceTimersByTimeAsync(400);
      const result = await promise;
      expect(result).toBe("");
    });

    it("resolves with AI text when response arrives before timeout", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const client = makeMockClient([]);
      injectClient(bridge, client);

      let callCount = 0;
      client.session.messages.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: [] }); // baseline
        return Promise.resolve({
          data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "answer" }] }],
        });
      });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 10_000, 100);
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;
      expect(result).toBe("answer");
    });
  });

  /* ── Circuit breaker transitions ─────────────────────────────── */

  describe("circuit breaker open / half-open / close transitions", () => {
    it("circuit opens after failureThreshold consecutive sendAndWait failures", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), {
        maxRestarts: 5,
        initialBackoffMs: 60_000, // long backoff — won't fire during this test
      });
      (bridge as any)._doStart = vi.fn().mockResolvedValue(undefined);
      (bridge as any).checkHealth = vi.fn().mockResolvedValue(false);
      injectClient(bridge, makeMockClient());

      // Make every _sendAndWaitInternal call throw
      (bridge as any)._sendAndWaitInternal = vi.fn().mockRejectedValue(new Error("network error"));

      // Default failureThreshold is 3 (CircuitBreaker default)
      for (let i = 0; i < 3; i++) {
        await bridge.sendAndWait("s1", "hi").catch(() => {});
      }

      expect(bridge.getCircuitBreaker().getState()).toBe("OPEN");
    });

    it("half-open probe accepted — circuit transitions to CLOSED", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      injectClient(bridge, makeMockClient());

      // Open the circuit directly to avoid restart-scheduler side effects
      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure(); // → OPEN (recoveryTimeoutMs = 15_000)

      // Advance past recovery timeout so the next allowRequest() enters HALF_OPEN
      vi.advanceTimersByTime(15_001);
      expect(cb.getState()).toBe("HALF_OPEN");

      // Probe succeeds
      (bridge as any)._sendAndWaitInternal = vi.fn().mockResolvedValue("probe ok");
      const result = await bridge.sendAndWait("s1", "probe");

      expect(result).toBe("probe ok");
      expect(cb.getState()).toBe("CLOSED");
    });

    it("half-open probe rejected — circuit re-opens (OPEN)", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), {
        maxRestarts: 5,
        initialBackoffMs: 60_000, // long backoff so timer doesn't fire during test
      });
      (bridge as any)._doStart = vi.fn().mockResolvedValue(undefined);
      (bridge as any).checkHealth = vi.fn().mockResolvedValue(false);
      injectClient(bridge, makeMockClient());

      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure(); // → OPEN

      vi.advanceTimersByTime(15_001);
      expect(cb.getState()).toBe("HALF_OPEN");

      // Probe fails
      (bridge as any)._sendAndWaitInternal = vi.fn().mockRejectedValue(new Error("still down"));
      await bridge.sendAndWait("s1", "probe").catch(() => {});

      expect(cb.getState()).toBe("OPEN");
    });

    it("subsequent requests succeed after circuit closes following a probe", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      injectClient(bridge, makeMockClient());

      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure();
      vi.advanceTimersByTime(15_001);

      // Probe succeeds → CLOSED
      (bridge as any)._sendAndWaitInternal = vi.fn().mockResolvedValue("ok");
      await bridge.sendAndWait("s1", "probe");
      expect(cb.getState()).toBe("CLOSED");

      // After closing, allowRequest should return true (normal operation)
      expect(cb.allowRequest()).toBe(true);
    });

    it("drops message (returns empty) when circuit is OPEN and queue is full", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), { maxQueueSize: 0 });
      injectClient(bridge, makeMockClient());

      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure(); // OPEN

      // maxQueueSize=0 means queue is always "full"
      const result = await bridge.sendAndWait("s1", "hi");
      expect(result).toBe("");
    });
  });
});

describe("OpenCodeBridge — subscribeEvents abort signal handling", () => {
  it("resolves promptly when signal is aborted mid-stream with no new chunks", async () => {
    const bridge = new OpenCodeBridge(makeConfig(), makeLogger());

    // Create a stream that never yields (simulates a stalled SSE connection)
    let iteratorReturnCalled = false;
    const neverEndingIterator = {
      next: () => new Promise<{ done: boolean; value: unknown }>(() => {}), // never resolves
      return: async () => {
        iteratorReturnCalled = true;
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    // Mock the client to return our stalled stream
    const mockClient = {
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: neverEndingIterator,
        }),
      },
    };
    injectClient(bridge, mockClient as any);

    const controller = new AbortController();
    const subscribePromise = bridge.subscribeEvents(() => {}, controller.signal);

    // Abort the signal after a tick — subscribeEvents should resolve quickly
    await Promise.resolve();
    controller.abort();

    await expect(subscribePromise).resolves.toBeUndefined();
    expect(iteratorReturnCalled).toBe(true);
  });

  it("resolves immediately when signal is already aborted before iteration begins", async () => {
    const bridge = new OpenCodeBridge(makeConfig(), makeLogger());

    // A stream that never yields — should never be iterated at all
    let iteratorReturnCalled = false;
    const neverEndingIterator = {
      next: () => new Promise<{ done: boolean; value: unknown }>(() => {}), // never resolves
      return: async () => {
        iteratorReturnCalled = true;
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    const mockClient = {
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: neverEndingIterator,
        }),
      },
    };
    injectClient(bridge, mockClient as any);

    // Abort the controller BEFORE calling subscribeEvents
    const controller = new AbortController();
    controller.abort();

    await expect(bridge.subscribeEvents(() => {}, controller.signal)).resolves.toBeUndefined();
    expect(iteratorReturnCalled).toBe(true);
  });

  it("resolves normally when stream ends without abort", async () => {
    const bridge = new OpenCodeBridge(makeConfig(), makeLogger());

    // A stream that yields one chunk then ends
    const finiteIterator = {
      calls: 0,
      next() {
        this.calls++;
        if (this.calls === 1) return Promise.resolve({ done: false, value: {} });
        return Promise.resolve({ done: true, value: undefined });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    const mockClient = {
      event: {
        subscribe: vi.fn().mockResolvedValue({
          stream: finiteIterator,
        }),
      },
    };
    injectClient(bridge, mockClient as any);

    const controller = new AbortController();
    await expect(bridge.subscribeEvents(() => {}, controller.signal)).resolves.toBeUndefined();
  });
});
