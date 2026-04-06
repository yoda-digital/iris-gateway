/**
 * test/unit/message-router-branches.test.ts
 *
 * Covers routing, filtering, and dispatch edge-cases in MessageRouter:
 *  - no adapter for channel (Steps 1 / sendResponse fallback)
 *  - security denied without a rejection message
 *  - mention-gating filter (group message not mentioning bot)
 *  - mention-gating pass-through (group message with bot mention)
 *  - auto-reply without forwardToAi
 *  - auto-reply with forwardToAi (continues to AI)
 *  - first-contact meta-prompt injection
 *  - streaming coalescer setup path
 */

import { describe, it, expect, vi } from "vitest";
import { TemplateEngine } from "../../src/auto-reply/engine.js";
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

describe("MessageRouter — no adapter fallback", () => {
  it("sendResponse logs warning and returns when adapter is not registered", async () => {
    const { tempDir, router } = makeEnv({ withAdapter: false });
    try {
      // Should not throw — just warn internally
      await expect(
        router.sendResponse("nonexistent-channel", "chat-1", "hello"),
      ).resolves.toBeUndefined();
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("handleInbound still processes security check even when adapter is absent", async () => {
    const { tempDir, router } = makeEnv({ withAdapter: false });
    try {
      // Should not throw — adapter absence is handled gracefully
      await expect(
        router.handleInbound(makeInboundMessage({ channelId: "mock" })),
      ).resolves.toBeUndefined();
    } finally {
      router.dispose();
      await new Promise(r => setTimeout(r, 50));
      cleanup(tempDir);
    }
  });
});

describe("MessageRouter — security gate denied branches", () => {
  it("security denied with rejection message but no adapter — no throw", async () => {
    // 'disabled' policy always denies with a message, but adapter not registered
    const { tempDir, router } = makeEnv({ dmPolicy: "disabled", withAdapter: false });
    try {
      await expect(
        router.handleInbound(makeInboundMessage({ channelId: "mock" })),
      ).resolves.toBeUndefined();
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("security denied with rejection message sends it via adapter", async () => {
    const { tempDir, router, adapter } = makeEnv({ dmPolicy: "disabled" });
    try {
      await router.handleInbound(makeInboundMessage({ channelId: "mock" }));
      const sends = adapter.calls.filter(c => c.method === "sendText");
      expect(sends.length).toBe(1);
      expect((sends[0]!.args[0] as any).text).toContain("disabled");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

describe("MessageRouter — mention gating (group messages)", () => {
  const channelConfigs = {
    mock: {
      groupPolicy: { enabled: true, requireMention: true },
      mentionPattern: "@testbot",
    },
  };

  it("filters group message when bot is not mentioned", async () => {
    const { tempDir, bridge, router, adapter } = makeEnv({ channelConfigs });
    try {
      const sendAndWaitSpy = vi.spyOn(bridge, "sendAndWait");
      await router.handleInbound(
        makeInboundMessage({ channelId: "mock", chatType: "group", text: "hello everyone" }),
      );
      // No AI call, no typing, no send
      expect(sendAndWaitSpy).not.toHaveBeenCalled();
      expect(adapter.calls.filter(c => c.method === "sendText").length).toBe(0);
      expect(adapter.calls.filter(c => c.method === "sendTyping").length).toBe(0);
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("passes group message through when bot is mentioned", async () => {
    const { tempDir, bridge, router, adapter } = makeEnv({ channelConfigs });
    try {
      bridge.responseText = "pong";
      const sendAndWaitSpy = vi.spyOn(bridge, "sendAndWait");
      await router.handleInbound(
        makeInboundMessage({ channelId: "mock", chatType: "group", text: "hey @testbot what time is it?" }),
      );
      expect(sendAndWaitSpy).toHaveBeenCalled();
      expect(adapter.calls.filter(c => c.method === "sendTyping").length).toBe(1);
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("strips bot mention from text before forwarding to AI", async () => {
    const { tempDir, bridge, router } = makeEnv({ channelConfigs });
    try {
      bridge.responseText = "ok";
      let capturedText = "";
      vi.spyOn(bridge, "sendAndWait").mockImplementation(async (_sid, text) => {
        capturedText = text;
        return "ok";
      });
      await router.handleInbound(
        makeInboundMessage({ channelId: "mock", chatType: "group", text: "@testbot hello there" }),
      );
      // The mention should have been stripped from the forwarded text
      expect(capturedText).not.toContain("@testbot");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

describe("MessageRouter — auto-reply template engine", () => {
  it("matches auto-reply and returns without calling AI when forwardToAi is false", async () => {
    const engine = new TemplateEngine([
      {
        id: "greet",
        trigger: { type: "exact", pattern: "hi bot" },
        response: "Hello human!",
        forwardToAi: false,
      },
    ]);
    const { tempDir, bridge, router, adapter } = makeEnv({ templateEngine: engine });
    try {
      const sendAndWaitSpy = vi.spyOn(bridge, "sendAndWait");
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "hi bot" }));
      expect(sendAndWaitSpy).not.toHaveBeenCalled();
      const sends = adapter.calls.filter(c => c.method === "sendText");
      expect(sends.length).toBe(1);
      expect((sends[0]!.args[0] as any).text).toBe("Hello human!");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("matches auto-reply AND forwards to AI when forwardToAi is true", async () => {
    const engine = new TemplateEngine([
      {
        id: "greet-forward",
        trigger: { type: "exact", pattern: "hi bot" },
        response: "Auto: hello!",
        forwardToAi: true,
      },
    ]);
    const { tempDir, bridge, router, adapter } = makeEnv({ templateEngine: engine });
    try {
      bridge.responseText = "AI reply";
      const sendAndWaitSpy = vi.spyOn(bridge, "sendAndWait");
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "hi bot" }));
      // Both auto-reply AND AI call should happen
      expect(sendAndWaitSpy).toHaveBeenCalled();
      const sends = adapter.calls.filter(c => c.method === "sendText");
      expect(sends.length).toBeGreaterThanOrEqual(1);
      const texts = sends.map(s => (s.args[0] as any).text);
      expect(texts.some(t => t === "Auto: hello!")).toBe(true);
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("does not send auto-reply when no template matches", async () => {
    const engine = new TemplateEngine([
      {
        id: "greet",
        trigger: { type: "exact", pattern: "hi bot" },
        response: "Hello!",
        forwardToAi: false,
      },
    ]);
    const { tempDir, bridge, router } = makeEnv({ templateEngine: engine });
    try {
      bridge.responseText = "AI answer";
      const sendAndWaitSpy = vi.spyOn(bridge, "sendAndWait");
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "something else" }));
      expect(sendAndWaitSpy).toHaveBeenCalled();
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

describe("MessageRouter — first-contact meta-prompt injection", () => {
  it("prepends FIRST CONTACT prefix when profileEnricher reports first contact", async () => {
    const profileEnricher = { isFirstContact: () => true };
    const vaultStoreRef = { getProfile: () => ({ id: "user-1" }) };
    const { tempDir, bridge, router } = makeEnv({ profileEnricher, vaultStoreRef });
    try {
      let capturedText = "";
      vi.spyOn(bridge, "sendAndWait").mockImplementation(async (_sid, text) => {
        capturedText = text;
        return "welcome response";
      });
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "hello" }));
      expect(capturedText).toContain("FIRST CONTACT");
      expect(capturedText).toContain("hello");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("does not prepend prefix for returning users", async () => {
    const profileEnricher = { isFirstContact: () => false };
    const vaultStoreRef = { getProfile: () => ({ id: "user-1" }) };
    const { tempDir, bridge, router } = makeEnv({ profileEnricher, vaultStoreRef });
    try {
      let capturedText = "";
      vi.spyOn(bridge, "sendAndWait").mockImplementation(async (_sid, text) => {
        capturedText = text;
        return "ok";
      });
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "hello again" }));
      expect(capturedText).not.toContain("FIRST CONTACT");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("skips enrichment when profile is null", async () => {
    const profileEnricher = { isFirstContact: vi.fn() };
    const vaultStoreRef = { getProfile: () => null };
    const { tempDir, bridge, router } = makeEnv({ profileEnricher, vaultStoreRef });
    try {
      bridge.responseText = "ok";
      await router.handleInbound(makeInboundMessage({ channelId: "mock", text: "hi" }));
      // isFirstContact should not be called since profile is null
      expect(profileEnricher.isFirstContact).not.toHaveBeenCalled();
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

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
      // Should complete without error; coalescer path is exercised
      await expect(
        router.handleInbound(makeInboundMessage({ channelId: "mock", text: "stream test" })),
      ).resolves.toBeUndefined();
      // Typing was sent, meaning processing reached step 8
      expect(adapter.calls.filter(c => c.method === "sendTyping").length).toBe(1);
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});
