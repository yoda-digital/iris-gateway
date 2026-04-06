import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenCodeBridge } from "../../src/bridge/opencode-client.js";
import {
  makeConfig,
  makeLogger,
  injectClient,
  makeMockClient,
} from "../helpers/opencode-bridge-env.js";

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("OpenCodeBridge", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  /* ── stripThinking (via listMessages) ─────────────────────────── */

  describe("stripThinking via listMessages", () => {
    it("removes <think> blocks from text", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const client = makeMockClient([
        { role: "assistant", text: "<think>internal</think>visible", hasParts: true },
      ]);
      injectClient(bridge, client);

      const msgs = await bridge.listMessages("s1");
      expect(msgs[0].text).toBe("visible");
    });

    it("removes <reasoning> blocks from text", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const client = makeMockClient([
        { role: "assistant", text: "<reasoning>step1</reasoning>answer", hasParts: true },
      ]);
      injectClient(bridge, client);

      const msgs = await bridge.listMessages("s1");
      expect(msgs[0].text).toBe("answer");
    });

    it("leaves plain text unchanged", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const client = makeMockClient([
        { role: "assistant", text: "just plain text", hasParts: true },
      ]);
      injectClient(bridge, client);

      const msgs = await bridge.listMessages("s1");
      expect(msgs[0].text).toBe("just plain text");
    });

    it("removes multiple thinking blocks", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const client = makeMockClient([
        { role: "assistant", text: "<think>a</think>hello<reasoning>b</reasoning> world", hasParts: true },
      ]);
      injectClient(bridge, client);

      const msgs = await bridge.listMessages("s1");
      expect(msgs[0].text).toBe("hello world");
    });
  });

  /* ── getQueueSize / isAvailable ───────────────────────────────── */

  describe("getQueueSize / getInFlightCount / getPendingQueueSize / isAvailable", () => {
    it("getQueueSize returns 0 initially (backwards compat)", () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      expect(bridge.getQueueSize()).toBe(0);
    });

    it("getInFlightCount returns 0 initially", () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      expect(bridge.getInFlightCount()).toBe(0);
    });

    it("getPendingQueueSize returns 0 initially", () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      expect(bridge.getPendingQueueSize()).toBe(0);
    });

    it("isAvailable returns true when circuit is CLOSED", () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      expect(bridge.isAvailable()).toBe(true);
    });

    it("isAvailable returns false when circuit is OPEN", () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure();
      expect(bridge.isAvailable()).toBe(false);
    });
  });

  /* ── stop lifecycle ───────────────────────────────────────────── */

  describe("stop lifecycle", () => {
    it("clears client and serverHandle", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const closeFn = vi.fn();
      (bridge as any).client = {};
      (bridge as any).serverHandle = { url: "http://localhost:4096", close: closeFn };

      await bridge.stop();
      expect(closeFn).toHaveBeenCalledOnce();
      expect((bridge as any).client).toBeNull();
      expect((bridge as any).serverHandle).toBeNull();
    });

    it("is safe to call when client and serverHandle are null", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      await expect(bridge.stop()).resolves.toBeUndefined();
    });
  });

  /* ── sendAndWait queue overflow ───────────────────────────────── */

  describe("sendAndWait queue overflow", () => {
    it("returns empty string when pendingQueue >= maxQueueSize while circuit OPEN", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), { maxQueueSize: 2 });
      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure(); // OPEN

      // Fill queue to max
      (bridge as any).supervisor.pendingQueue.push(() => {}, () => {});

      const result = await bridge.sendAndWait("s1", "hello");
      expect(result).toBe("");
    });
  });

  /* ── sendAndWait drain on recovery ────────────────────────────── */

  describe("sendAndWait drain on recovery", () => {
    it("queues message and resolves after circuit closes + drainQueue", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), { maxQueueSize: 10 });
      injectClient(bridge, makeMockClient());
      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure(); // OPEN

      // Mock _sendAndWaitInternal to return quickly
      (bridge as any)._sendAndWaitInternal = vi.fn().mockResolvedValue("response text");

      // Start sendAndWait — it will queue and wait
      const promise = bridge.sendAndWait("s1", "hi");

      // Simulate recovery: close circuit and drain
      cb.onSuccess();
      (bridge as any).supervisor.drainQueue();

      const result = await promise;
      expect(result).toBe("response text");
    });
  });

  /* ── circuit breaker onFailure on error ───────────────────────── */

  describe("sendAndWait error path — circuit breaker onFailure", () => {
    it("calls circuitBreaker.onFailure() and schedules restart when _sendAndWaitInternal throws", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), {
        initialBackoffMs: 100,
        maxRestarts: 5,
      });

      // Mock _sendAndWaitInternal to throw
      (bridge as any)._sendAndWaitInternal = vi.fn().mockRejectedValue(new Error("network failure"));

      // Spy on circuitBreaker and supervisor.scheduleRestart
      const cb = bridge.getCircuitBreaker();
      const onFailureSpy = vi.spyOn(cb, "onFailure");
      const scheduleRestartSpy = vi.spyOn((bridge as any).supervisor, "scheduleRestart");
      // sendAndWait re-throws after notifying circuit breaker
      await expect(bridge.sendAndWait("s1", "hello")).rejects.toThrow("network failure");
      expect(onFailureSpy).toHaveBeenCalledOnce();
      expect(scheduleRestartSpy).toHaveBeenCalled();
    });
  });

  /* ── re-check after drain still OPEN ─────────────────────────── */

  describe("sendAndWait re-check after drain still OPEN", () => {
    it("returns empty string when queued message is drained but circuit is still OPEN", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), { maxQueueSize: 10 });
      injectClient(bridge, makeMockClient());
      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure(); // OPEN

      // Do NOT mock _sendAndWaitInternal — circuit stays OPEN so it won't be called

      // Start sendAndWait — it will queue and wait
      const promise = bridge.sendAndWait("s1", "hi");

      // Drain queue WITHOUT closing circuit (recovery failed)
      (bridge as any).supervisor.drainQueue();

      const result = await promise;
      expect(result).toBe("");
    });
  });

  /* ── deleteSession ───────────────────────────────────────────── */

  describe("deleteSession", () => {
    it("deletes a session successfully", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const deleteFn = vi.fn().mockResolvedValue({});
      const client = { session: { delete: deleteFn } };
      injectClient(bridge, client);

      await bridge.deleteSession("s1");

      expect(deleteFn).toHaveBeenCalledWith({
        path: { id: "s1" },
        throwOnError: true,
      });
    });

    it("throws when client is null", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      (bridge as any).client = null;

      await expect(bridge.deleteSession("s1")).rejects.toThrow("OpenCode bridge not started");
    });
  });

  /* ── abortSession ────────────────────────────────────────────── */

  describe("abortSession", () => {
    it("aborts a session successfully", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const abortFn = vi.fn().mockResolvedValue({});
      const client = { session: { abort: abortFn } };
      injectClient(bridge, client);

      await bridge.abortSession("s1");

      expect(abortFn).toHaveBeenCalledWith({
        path: { id: "s1" },
        throwOnError: true,
      });
    });

    it("throws when client is null", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      (bridge as any).client = null;

      await expect(bridge.abortSession("s1")).rejects.toThrow("OpenCode bridge not started");
    });
  });

  /* ── listSessions ────────────────────────────────────────────── */

  describe("listSessions", () => {
    it("lists sessions successfully", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const listFn = vi.fn().mockResolvedValue({
        data: {
          s1: { id: "s1", title: "Session 1", time: { created: 1000 } },
          s2: { id: "s2", title: null, time: { created: 2000 } },
        },
      });
      const client = { session: { list: listFn } };
      injectClient(bridge, client);

      const sessions = await bridge.listSessions();

      expect(listFn).toHaveBeenCalledWith({ throwOnError: true });
      expect(sessions).toEqual([
        { id: "s1", title: "Session 1", createdAt: 1000 },
        { id: "s2", title: "", createdAt: 2000 },
      ]);
    });

    it("throws when client is null", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      (bridge as any).client = null;

      await expect(bridge.listSessions()).rejects.toThrow("OpenCode bridge not started");
    });
  });

  /* ── checkHealth ─────────────────────────────────────────────── */

  describe("checkHealth", () => {
    it("returns true when session.list succeeds", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const listFn = vi.fn().mockResolvedValue({ data: {} });
      const client = { session: { list: listFn } };
      injectClient(bridge, client);

      const result = await bridge.checkHealth();

      expect(result).toBe(true);
      expect(listFn).toHaveBeenCalled();
    });

    it("returns false and logs warning when session.list fails", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      const listFn = vi.fn().mockRejectedValue(new Error("connection refused"));
      const client = { session: { list: listFn } };
      injectClient(bridge, client);
      const loggerWarnSpy = vi.spyOn((bridge as any).logger, "warn");

      const result = await bridge.checkHealth();

      expect(result).toBe(false);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        { err: new Error("connection refused") },
        "OpenCode health check failed",
      );
    });

    it("returns false when client is null (health check catches error)", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      (bridge as any).client = null;
      const loggerWarnSpy = vi.spyOn((bridge as any).logger, "warn");

      const result = await bridge.checkHealth();

      expect(result).toBe(false);
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });
});
