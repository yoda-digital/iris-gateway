import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenCodeBridge } from "../../src/bridge/opencode-client.js";
import type { OpenCodeConfig } from "../../src/config/types.js";
import type { Logger } from "../../src/logging/logger.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

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
  return { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => makeLogger() } as unknown as Logger;
}

/** Inject a fake client into the bridge (bypassing start()). */
function injectClient(bridge: OpenCodeBridge, client: Record<string, unknown>): void {
  (bridge as any).client = client;
}

/** Build a minimal mock client with session.messages returning the given list. */
function makeMockClient(messages: Array<{ role: string; text: string; hasParts: boolean }> = []) {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: {} }),
      messages: vi.fn().mockResolvedValue({
        data: messages.map((m) => ({
          info: { role: m.role },
          parts: m.hasParts
            ? [{ type: "text", text: m.text }]
            : [],
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

  /* ── supervisor.scheduleRestart backoff ───────────────────────── */

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

      // Not yet fired
      vi.advanceTimersByTime(499);
      expect(doStart).not.toHaveBeenCalled();

      // Fire at 500ms
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

      // attempt=3 → 1000*2^3 = 8000 → capped to 4000
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

      // First call sets _isRestarting=true synchronously
      (bridge as any).supervisor.scheduleRestart(0);
      // Second call is a no-op because _isRestarting is already true
      (bridge as any).supervisor.scheduleRestart(0);

      // Advance past both possible backoff windows — only one doStart should fire
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

  /* ── _sendAndWaitInternal poll loop ───────────────────────────── */

  describe("_sendAndWaitInternal poll loop", () => {
    let bridge: OpenCodeBridge;
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      fetchSpy = vi.fn().mockResolvedValue({ status: 200 });
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns text when ready on first poll", async () => {
      const client = makeMockClient([]);
      injectClient(bridge, client);

      // First call (before): no messages
      // Second call (poll): assistant message ready
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
      await vi.advanceTimersByTimeAsync(100); // poll 1: only [user interrupted]
      await vi.advanceTimersByTimeAsync(100); // poll 2: real answer
      const result = await promise;
      expect(result).toBe("real answer");
    });

    it("returns empty string on timeout", async () => {
      const client = makeMockClient([]);
      injectClient(bridge, client);

      // Always return no new messages
      client.session.messages.mockResolvedValue({ data: [] });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100);
      await vi.advanceTimersByTimeAsync(600);
      const result = await promise;
      expect(result).toBe("");
    });

    it("returns empty string for tool-calls-only after stablePolls >= 5", async () => {
      const client = makeMockClient([]);
      injectClient(bridge, client);

      // No messages first, then assistant with parts but no text (tool call)
      let callCount = 0;
      client.session.messages.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: [] });
        // Assistant message with parts (hasParts=true) but no text parts → tool-calls-only
        return Promise.resolve({
          data: [
            { info: { role: "assistant" }, parts: [{ type: "tool_use", id: "t1" }] },
          ],
        });
      });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 60_000, 100);
      // Need 5 stable polls
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
          // stillGenerating: assistant message with no parts
          return Promise.resolve({
            data: [{ info: { role: "assistant" }, parts: [] }],
          });
        }
        // Now ready with text
        return Promise.resolve({
          data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done thinking" }] }],
        });
      });

      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 60_000, 100);
      await vi.advanceTimersByTimeAsync(100); // poll 1: generating
      await vi.advanceTimersByTimeAsync(100); // poll 2: generating
      await vi.advanceTimersByTimeAsync(100); // poll 3: done
      const result = await promise;
      expect(result).toBe("done thinking");
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

  /* ── PromptOptions ───────────────────────────────────────────── */

  describe("PromptOptions", () => {
    let bridge: OpenCodeBridge;
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      bridge = new OpenCodeBridge(makeConfig(), makeLogger());
      injectClient(bridge, makeMockClient());
      fetchSpy = vi.fn().mockResolvedValue({ status: 200 });
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("uses default agent when no options provided", async () => {
      fetchSpy.mockResolvedValue({ status: 200 });
      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100, {});
      await vi.advanceTimersByTimeAsync(600);
      await promise;

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(callBody.agent).toBe("chat");
      expect(callBody.model).toBeUndefined();
      expect(callBody.system).toBeUndefined();
      expect(callBody.tools).toBeUndefined();
      expect(callBody.noReply).toBeUndefined();
    });

    it("includes model in prompt body when set", async () => {
      fetchSpy.mockResolvedValue({ status: 200 });
      const options = { model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" } };
      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100, options);
      await vi.advanceTimersByTimeAsync(600);
      await promise;

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(callBody.model).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" });
    });

    it("includes system in prompt body when set", async () => {
      fetchSpy.mockResolvedValue({ status: 200 });
      const options = { system: "You are a helpful assistant" };
      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100, options);
      await vi.advanceTimersByTimeAsync(600);
      await promise;

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(callBody.system).toBe("You are a helpful assistant");
    });

    it("includes tools in prompt body when set", async () => {
      fetchSpy.mockResolvedValue({ status: 200 });
      const options = { tools: { bash: true, edit: false } };
      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100, options);
      await vi.advanceTimersByTimeAsync(600);
      await promise;

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(callBody.tools).toEqual({ bash: true, edit: false });
    });

    it("includes noReply in prompt body when set to true", async () => {
      fetchSpy.mockResolvedValue({ status: 200 });
      const options = { noReply: true };
      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100, options);
      await vi.advanceTimersByTimeAsync(600);
      await promise;

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(callBody.noReply).toBe(true);
    });

    it("includes noReply in prompt body when set to false", async () => {
      fetchSpy.mockResolvedValue({ status: 200 });
      const options = { noReply: false };
      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100, options);
      await vi.advanceTimersByTimeAsync(600);
      await promise;

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(callBody.noReply).toBe(false);
    });

    it("uses custom agent when provided", async () => {
      fetchSpy.mockResolvedValue({ status: 200 });
      const options = { agent: "code-reviewer" };
      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100, options);
      await vi.advanceTimersByTimeAsync(600);
      await promise;

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(callBody.agent).toBe("code-reviewer");
    });

    it("includes all options when all are set", async () => {
      fetchSpy.mockResolvedValue({ status: 200 });
      const options = {
        agent: "translator",
        model: { providerID: "openai", modelID: "gpt-4" },
        system: "Translate to French",
        tools: { bash: false },
        noReply: true,
      };
      const promise = (bridge as any)._sendAndWaitInternal("s1", "hi", 500, 100, options);
      await vi.advanceTimersByTimeAsync(600);
      await promise;

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(callBody).toEqual({
        agent: "translator",
        model: { providerID: "openai", modelID: "gpt-4" },
        system: "Translate to French",
        tools: { bash: false },
        noReply: true,
        parts: [{ type: "text", text: "hi" }],
      });
    });
  });
});
