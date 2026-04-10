/**
 * test/unit/message-router-streaming.test.ts
 *
 * Covers streaming coalescer setup/edit-in-place paths and event handler
 * dispatch (partial, response, error) in MessageRouter.
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

describe("MessageRouter — streaming coalescer path", () => {
  it("sets up a StreamCoalescer when streaming is enabled for the channel", async () => {
    const channelConfigs = {
      mock: {
        streaming: {
          enabled: true,
          minChars: 50,
          maxChars: 1000,
          idleMs: 100,
          breakOn: "paragraph" as const,
          editInPlace: false,
        },
      },
    };
    const { tempDir, bridge, router, adapter } = makeEnv({ channelConfigs });
    try {
      bridge.responseText = "streaming response";
      await expect(
        router.handleInbound(makeInboundMessage({ channelId: "mock", text: "stream test" })),
      ).resolves.toBeUndefined();
      expect(adapter.calls.filter(c => c.method === "sendTyping").length).toBe(1);
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("editInPlace: true — captures messageId on first chunk, calls editMessage on subsequent chunks", async () => {
    const channelConfigs = {
      mock: {
        streaming: {
          enabled: true,
          minChars: 20,
          maxChars: 100,
          idleMs: 50,
          breakOn: "paragraph" as const,
          editInPlace: true,
        },
      },
    };
    const { tempDir, bridge, router, adapter } = makeEnv({ channelConfigs });
    try {
      let resolveWait: (() => void) | null = null;
      const waitPromise = new Promise<string>((resolve) => {
        resolveWait = () => resolve("");
      });
      vi.spyOn(bridge, "sendAndWait").mockReturnValue(waitPromise);

      const handlePromise = router.handleInbound(makeInboundMessage({ channelId: "mock", text: "stream with edits" }));

      await new Promise(r => setTimeout(r, 10));

      const eh = router.getEventHandler();
      const sessionId = [...bridge.sessions.keys()][0]!;

      (eh.events as any).emit("partial", sessionId, "This is the first chunk of text that exceeds minimum threshold. ");
      await new Promise(r => setTimeout(r, 100));

      const sendTextCalls = adapter.calls.filter(c => c.method === "sendText");
      expect(sendTextCalls.length).toBe(1);
      const firstSend = sendTextCalls[0]!.args[0] as any;
      expect(firstSend.text).toContain("This is the first chunk");

      (eh.events as any).emit("partial", sessionId, "And here is more text. ");
      await new Promise(r => setTimeout(r, 100));

      const editCalls = adapter.calls.filter(c => c.method === "editMessage");
      expect(editCalls.length).toBeGreaterThanOrEqual(1);
      const firstEdit = editCalls[0]!.args[0] as any;
      expect(firstEdit.messageId).toBe("mock-1");
      expect(firstEdit.text).toContain("This is the first chunk");
      expect(firstEdit.text).toContain("And here is more text");

      (eh.events as any).emit("response", sessionId, "");
      resolveWait?.();
      await handlePromise;
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("editInPlace: true — skips edit when sentMessageId is null (first chunk not yet landed)", async () => {
    const channelConfigs = {
      mock: {
        streaming: {
          enabled: true,
          minChars: 20,
          maxChars: 100,
          idleMs: 50,
          breakOn: "paragraph" as const,
          editInPlace: true,
        },
      },
    };
    const { tempDir, bridge, router, adapter } = makeEnv({ channelConfigs });
    try {
      let resolveWait: (() => void) | null = null;
      const waitPromise = new Promise<string>((resolve) => {
        resolveWait = () => resolve("");
      });
      vi.spyOn(bridge, "sendAndWait").mockReturnValue(waitPromise);

      let resolveSendText: ((value: { messageId: string }) => void) | null = null;
      const sendTextPromise = new Promise<{ messageId: string }>((resolve) => {
        resolveSendText = resolve;
      });
      vi.spyOn(adapter, "sendText").mockImplementation(async (params) => {
        adapter.calls.push({ method: "sendText", args: [params] });
        return sendTextPromise;
      });

      const handlePromise = router.handleInbound(makeInboundMessage({ channelId: "mock", text: "delayed send" }));

      await new Promise(r => setTimeout(r, 10));

      const eh = router.getEventHandler();
      const sessionId = [...bridge.sessions.keys()][0]!;

      (eh.events as any).emit("partial", sessionId, "First chunk that will take time to send. ");
      await new Promise(r => setTimeout(r, 100));

      expect(adapter.calls.filter(c => c.method === "sendText").length).toBe(1);

      (eh.events as any).emit("partial", sessionId, "Second chunk arrives early. ");
      await new Promise(r => setTimeout(r, 100));

      const editCalls = adapter.calls.filter(c => c.method === "editMessage");
      expect(editCalls.length).toBe(0);

      resolveSendText?.({ messageId: "mock-delayed" });
      await new Promise(r => setTimeout(r, 10));

      (eh.events as any).emit("partial", sessionId, "Third chunk after resolve. ");
      await new Promise(r => setTimeout(r, 100));

      const editCallsAfter = adapter.calls.filter(c => c.method === "editMessage");
      expect(editCallsAfter.length).toBeGreaterThanOrEqual(1);
      const edit = editCallsAfter[0]!.args[0] as any;
      expect(edit.messageId).toBe("mock-delayed");

      (eh.events as any).emit("response", sessionId, "");
      resolveWait?.();
      await handlePromise;
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

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
    const { tempDir, router, adapter } = makeEnv();
    try {
      const pr = (router as any).turnGrouper["pendingResponses"] as Map<string, any>;
      pr.set("test-session", { channelId: "mock", chatId: "c1", replyToId: "r1", createdAt: Date.now() });

      const eh = router.getEventHandler();
      (eh.events as any).emit("error", "test-session", new Error("simulated error"));

      expect(pr.has("test-session")).toBe(false);

      await new Promise((r) => setTimeout(r, 10));

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
      expect(() => {
        (eh.events as any).emit("response", "no-such-session", "some text");
      }).not.toThrow();
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});
