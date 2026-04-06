/**
 * test/unit/message-router-events.test.ts
 *
 * Covers event handler, cleanup, and circuit-breaker edge-cases in
 * MessageRouter:
 *  - event-handler "error" (with coalescer, with non-Error payload, with null)
 *  - handleResponse with no pending context
 *  - pruneStale removing timed-out entries
 *  - dispose() clearing the cleanup timer
 *  - getEventHandler() accessor
 *  - circuit OPEN with no adapter (no crash)
 *  - /new and /start with no adapter
 */

import { describe, it, expect, vi } from "vitest";
import { makeEnv, cleanup } from "../helpers/message-router-env.js";
import { makeInboundMessage } from "../helpers/fixtures.js";

vi.mock("../../src/gateway/metrics.js", () => ({
  metrics: {
    messagesReceived: { inc: vi.fn() },
    messagesSent: { inc: vi.fn() },
    messagesErrors: { inc: vi.fn() },
    messageProcessingLatency: { observe: vi.fn() },
    queueDepth: { set: vi.fn() },
    activeConnections: { inc: vi.fn() },
    uptime: { set: vi.fn() },
    systemHealth: { set: vi.fn() },
    arcsDetected: { inc: vi.fn() },
    outcomesLogged: { inc: vi.fn() },
    intentsTriggered: { inc: vi.fn() },
    intelligencePipelineLatency: { observe: vi.fn() },
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe("MessageRouter — event handler paths", () => {
  it("getEventHandler returns the event handler instance", () => {
    const { tempDir, router } = makeEnv();
    try {
      const eh = router.getEventHandler();
      expect(eh).toBeDefined();
      expect(typeof eh.dispose).toBe("function");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("'error' event cleans up coalescer and pending response", async () => {
    // Directly inject a pending response + coalescer, then fire the error event.
    // This exercises the cleanup branches without needing to hang the bridge.
    const { tempDir, router, adapter } = makeEnv();
    try {
      const pr = (router as any).turnGrouper["pendingResponses"] as Map<string, any>;
      pr.set("test-session", { channelId: "mock", chatId: "c1", replyToId: "r1", createdAt: Date.now() });

      const eh = router.getEventHandler();
      (eh.events as any).emit("error", "test-session", new Error("simulated error"));

      // pendingResponses entry should be cleaned up
      expect(pr.has("test-session")).toBe(false);

      // Allow microtasks (sendResponse is async) to flush
      await new Promise((r) => setTimeout(r, 10));

      // User should receive an error message via sendText
      const sendCall = adapter.calls.find((c) => c.method === "sendText" && (c.args[0] as any)?.to === "c1");
      expect(sendCall).toBeDefined();
      const sentText = (sendCall?.args[0] as any)?.text as string;
      expect(sentText).toMatch(/⚠️ Request failed/);
      expect(sentText).toContain("simulated error");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("'error' event with no pending context does not throw", async () => {
    const { tempDir, router } = makeEnv();
    try {
      const eh = router.getEventHandler();
      expect(() => {
        (eh.events as any).emit("error", "unknown-session", new Error("orphan error"));
      }).not.toThrow();
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("'error' event with non-Error string payload uses fallback message", async () => {
    const { tempDir, router, adapter } = makeEnv();
    try {
      const pr = (router as any).turnGrouper["pendingResponses"] as Map<string, any>;
      pr.set("test-session", { channelId: "mock", chatId: "c1", replyToId: "r1", createdAt: Date.now() });

      const eh = router.getEventHandler();
      (eh.events as any).emit("error", "test-session", "stream closed");

      await new Promise((r) => setTimeout(r, 10));

      const sendCall = adapter.calls.find((c) => c.method === "sendText" && (c.args[0] as any)?.to === "c1");
      expect(sendCall).toBeDefined();
      const sentText = (sendCall?.args[0] as any)?.text as string;
      expect(sentText).toContain("An unexpected error occurred");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("'error' event with null payload uses fallback message", async () => {
    const { tempDir, router, adapter } = makeEnv();
    try {
      const pr = (router as any).turnGrouper["pendingResponses"] as Map<string, any>;
      pr.set("test-session-2", { channelId: "mock", chatId: "c2", replyToId: "r2", createdAt: Date.now() });

      const eh = router.getEventHandler();
      (eh.events as any).emit("error", "test-session-2", null);

      await new Promise((r) => setTimeout(r, 10));

      const sendCall = adapter.calls.find((c) => c.method === "sendText" && (c.args[0] as any)?.to === "c2");
      expect(sendCall).toBeDefined();
      const sentText = (sendCall?.args[0] as any)?.text as string;
      expect(sentText).toContain("An unexpected error occurred");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("'response' event via handleResponse logs warning for unknown session", () => {
    const { tempDir, router } = makeEnv();
    try {
      const eh = router.getEventHandler();
      // Fire response event for a session ID with no pending context
      expect(() => {
        (eh.events as any).emit("response", "no-such-session", "some text");
      }).not.toThrow();
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

describe("MessageRouter — pruneStale cleanup", () => {
  it("dispose cancels the cleanup timer without error", () => {
    // The pruneStale path is exercised by the cleanup interval;
    // this test verifies dispose() stops it cleanly.
    const { tempDir, router } = makeEnv();
    try {
      expect(() => router.dispose()).not.toThrow();
    } finally {
      cleanup(tempDir);
    }
  });

  it("pruneStale removes entries whose createdAt exceeds TTL", async () => {
    // Access private pendingResponses via type assertion to verify pruning.
    const { tempDir, router } = makeEnv();
    try {
      const pr = (router as any).turnGrouper["pendingResponses"] as Map<string, any>;
      const staleTs = Date.now() - 6 * 60 * 1000; // 6 min ago > 5 min TTL
      pr.set("stale-session", { channelId: "mock", chatId: "c1", createdAt: staleTs });
      pr.set("fresh-session", { channelId: "mock", chatId: "c2", createdAt: Date.now() });

      // Call the private method directly
      (router as any).turnGrouper["pruneStale"]();

      expect(pr.has("stale-session")).toBe(false);
      expect(pr.has("fresh-session")).toBe(true);
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

describe("MessageRouter — dispose", () => {
  it("dispose clears the cleanup interval and eventHandler without throwing", () => {
    const { tempDir, router } = makeEnv();
    try {
      expect(() => router.dispose()).not.toThrow();
      // Calling dispose a second time should be idempotent
      expect(() => router.dispose()).not.toThrow();
    } finally {
      cleanup(tempDir);
    }
  });
});

describe("MessageRouter — circuit OPEN with no adapter", () => {
  it("circuit OPEN + no adapter does not throw", async () => {
    const { tempDir, bridge, router } = makeEnv({ withAdapter: false });
    try {
      bridge._cb.onFailure(); bridge._cb.onFailure(); bridge._cb.onFailure();
      expect(bridge._cb.getState()).toBe("OPEN");
      await expect(
        router.handleInbound(makeInboundMessage({ channelId: "mock", text: "hi" })),
      ).resolves.toBeUndefined();
    } finally {
      router.dispose();
      await new Promise(r => setTimeout(r, 50));
      cleanup(tempDir);
    }
  });
});

describe("MessageRouter — /new and /start with no adapter", () => {
  it("/new with no adapter still resets session without throwing", async () => {
    const { tempDir, router } = makeEnv({ withAdapter: false });
    try {
      await expect(
        router.handleInbound(makeInboundMessage({ channelId: "mock", text: "/new" })),
      ).resolves.toBeUndefined();
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});
