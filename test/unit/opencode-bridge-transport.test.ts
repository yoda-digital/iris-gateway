import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenCodeBridge } from "../../src/bridge/opencode-client.js";
import { makeConfig, makeLogger, injectClient, makeMockClient } from "../helpers/opencode-bridge-env.js";

describe("OpenCodeBridge — transport", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  describe("sendAndWait queue overflow", () => {
    it("returns empty string when pendingQueue >= maxQueueSize while circuit OPEN", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), { maxQueueSize: 2 });
      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure();

      (bridge as any).supervisor.pendingQueue.push(() => {}, () => {});

      const result = await bridge.sendAndWait("s1", "hello");
      expect(result).toBe("");
    });
  });

  describe("sendAndWait drain on recovery", () => {
    it("queues message and resolves after circuit closes + drainQueue", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), { maxQueueSize: 10 });
      injectClient(bridge, makeMockClient());
      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure();

      (bridge as any)._sendAndWaitInternal = vi.fn().mockResolvedValue("response text");

      const promise = bridge.sendAndWait("s1", "hi");

      cb.onSuccess();
      (bridge as any).supervisor.drainQueue();

      const result = await promise;
      expect(result).toBe("response text");
    });
  });

  describe("supervisor.scheduleRestart backoff", () => {
    it("fires after initialBackoffMs at attempt 0", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), {
        initialBackoffMs: 500,
        maxBackoffMs: 10_000,
        maxRestarts: 5,
      });
      const doStart = vi.fn().mockResolvedValue(undefined);
      (bridge as any)._doStart = doStart;
      (bridge as any).checkHealth = vi.fn().mockResolvedValue(true);

      (bridge as any).supervisor.scheduleRestart(0);

      vi.advanceTimersByTime(499);
      expect(doStart).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(doStart).toHaveBeenCalledOnce();
    });

    it("caps backoff at maxBackoffMs", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), {
        initialBackoffMs: 1_000,
        maxBackoffMs: 4_000,
        maxRestarts: 10,
      });
      const doStart = vi.fn().mockResolvedValue(undefined);
      (bridge as any)._doStart = doStart;
      (bridge as any).checkHealth = vi.fn().mockResolvedValue(true);

      (bridge as any).supervisor.scheduleRestart(3);
      vi.advanceTimersByTime(3_999);
      expect(doStart).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(doStart).toHaveBeenCalledOnce();
    });

    it("does NOT restart when isRestarting is true", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), {
        initialBackoffMs: 100,
        maxRestarts: 5,
      });
      const doStart = vi.fn().mockResolvedValue(undefined);
      (bridge as any)._doStart = doStart;
      (bridge as any).checkHealth = vi.fn().mockResolvedValue(true);

      (bridge as any).supervisor.scheduleRestart(0);
      (bridge as any).supervisor.scheduleRestart(0);

      await vi.advanceTimersByTimeAsync(200);
      expect(doStart).toHaveBeenCalledOnce();
    });

    it("calls onMaxRestartsExceeded at maxRestarts", () => {
      const exceeded = vi.fn();
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), {
        maxRestarts: 3,
        onMaxRestartsExceeded: exceeded,
      });

      (bridge as any).supervisor.scheduleRestart(3);
      expect(exceeded).toHaveBeenCalledOnce();
    });

    it("cleans serverHandle before restart", async () => {
      const closeFn = vi.fn();
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), {
        initialBackoffMs: 100,
        maxRestarts: 5,
      });
      (bridge as any).serverHandle = { url: "http://localhost", close: closeFn };
      (bridge as any)._doStart = vi.fn().mockResolvedValue(undefined);
      (bridge as any).checkHealth = vi.fn().mockResolvedValue(true);

      (bridge as any).supervisor.scheduleRestart(0);
      await vi.advanceTimersByTimeAsync(100);

      expect(closeFn).toHaveBeenCalledOnce();
      expect((bridge as any).serverHandle).toBeNull();
    });
  });

  describe("_sendAndWaitInternal poll loop", () => {
    let bridge: OpenCodeBridge;
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns text when ready on first poll", async () => {
      const client = makeMockClient([]);
      injectClient(bridge, client);

      let callCount = 0;
      client.session.messages
        .mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({ data: [] });
          }
          return Promise.resolve({
            data: [
              { info: { role: "assistant" }, parts: [{ type: "text", text: "hello world" }] },
            ],
          });
        });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 10_000, 100);
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;
      expect(result).toBe("hello world");
    });

    it("skips [user interrupted] messages", async () => {
      const client = makeMockClient([]);
      injectClient(bridge, client);

      let callCount = 0;
      client.session.messages.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: [] });
        if (callCount === 2) {
          return Promise.resolve({
            data: [
              { info: { role: "assistant" }, parts: [{ type: "text", text: "[user interrupted]" }] },
            ],
          });
        }
        return Promise.resolve({
          data: [
            { info: { role: "assistant" }, parts: [{ type: "text", text: "[user interrupted]" }] },
            { info: { role: "assistant" }, parts: [{ type: "text", text: "real answer" }] },
          ],
        });
      });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 10_000, 100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;
      expect(result).toBe("real answer");
    });

    it("returns empty string on timeout", async () => {
      const client = makeMockClient([]);
      injectClient(bridge, client);

      client.session.messages.mockResolvedValue({ data: [] });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100);
      await vi.advanceTimersByTimeAsync(600);
      const result = await promise;
      expect(result).toBe("");
    });

    it("returns empty string for tool-calls-only after stablePolls >= 5", async () => {
      const client = makeMockClient([]);
      injectClient(bridge, client);

      let callCount = 0;
      client.session.messages.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: [] });
        return Promise.resolve({
          data: [
            { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "t1" }] },
          ],
        });
      });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 60_000, 100);
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }
      const result = await promise;
      expect(result).toBe("");
    });

    it("waits while stillGenerating then returns text", async () => {
      const client = makeMockClient([]);
      injectClient(bridge, client);

      let callCount = 0;
      client.session.messages.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: [] });
        if (callCount <= 3) {
          return Promise.resolve({
            data: [{ info: { role: "assistant" }, parts: [] }],
          });
        }
        return Promise.resolve({
          data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done thinking" }] }],
        });
      });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 60_000, 100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;
      expect(result).toBe("done thinking");
    });
  });

  describe("sendAndWait error path — circuit breaker onFailure", () => {
    it("calls circuitBreaker.onFailure() and schedules restart when _sendAndWaitInternal throws", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), {
        initialBackoffMs: 100,
        maxRestarts: 5,
      });

      (bridge as any)._sendAndWaitInternal = vi.fn().mockRejectedValue(new Error("network failure"));

      const cb = bridge.getCircuitBreaker();
      const onFailureSpy = vi.spyOn(cb, "onFailure");
      const scheduleRestartSpy = vi.spyOn((bridge as any).supervisor, "scheduleRestart");
      await expect(bridge.sendAndWait("s1", "hello")).rejects.toThrow("network failure");
      expect(onFailureSpy).toHaveBeenCalledOnce();
      expect(scheduleRestartSpy).toHaveBeenCalled();
    });
  });

  describe("sendAndWait re-check after drain still OPEN", () => {
    it("returns empty string when queued message is drained but circuit is still OPEN", async () => {
      const bridge = new OpenCodeBridge(makeConfig(), makeLogger(), { maxQueueSize: 10 });
      injectClient(bridge, makeMockClient());
      const cb = bridge.getCircuitBreaker();
      cb.onFailure(); cb.onFailure(); cb.onFailure();

      const promise = bridge.sendAndWait("s1", "hi");

      (bridge as any).supervisor.drainQueue();

      const result = await promise;
      expect(result).toBe("");
    });
  });
});
