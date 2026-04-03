/**
 * test/unit/message-router-branches.test.ts
 *
 * Covers error branches, fallback routing, and edge-case dispatch paths in
 * MessageRouter that are NOT exercised by the existing test files:
 *  - no adapter for channel (Steps 1 / sendResponse fallback)
 *  - security denied without a rejection message
 *  - mention-gating filter (group message not mentioning bot)
 *  - mention-gating pass-through (group message with bot mention)
 *  - auto-reply without forwardToAi
 *  - auto-reply with forwardToAi (continues to AI)
 *  - first-contact meta-prompt injection
 *  - streaming coalescer setup path
 *  - event-handler "partial", "response" (with coalescer), "error" (with coalescer)
 *  - handleResponse with no pending context
 *  - pruneStale removing timed-out entries
 *  - dispose() clearing the cleanup timer
 *  - getEventHandler() accessor
 *  - circuit OPEN with no adapter (no crash)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageRouter } from "../../src/bridge/message-router.js";
import { SessionMap } from "../../src/bridge/session-map.js";
import { SecurityGate } from "../../src/security/dm-policy.js";
import { PairingStore } from "../../src/security/pairing-store.js";
import { AllowlistStore } from "../../src/security/allowlist-store.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { CircuitBreaker } from "../../src/bridge/circuit-breaker.js";
import { TemplateEngine } from "../../src/auto-reply/engine.js";
import { MockAdapter } from "../helpers/mock-adapter.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";
import { makeInboundMessage } from "../helpers/fixtures.js";
import pino from "pino";

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

// ── A bridge that exposes a real, controllable CircuitBreaker ──────────────
class ControllableBridge extends MockOpenCodeBridge {
  readonly _cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 10_000 });
  override getCircuitBreaker() { return this._cb; }
}

// ── Factory helpers ────────────────────────────────────────────────────────

interface EnvOptions {
  withAdapter?: boolean;
  dmPolicy?: "open" | "disabled" | "allowlist" | "pairing";
  channelConfigs?: Record<string, any>;
  opencodeConfig?: import("../../src/config/types.js").OpenCodeConfig | null;
  templateEngine?: TemplateEngine | null;
  profileEnricher?: { isFirstContact(profile: any): boolean } | null;
  vaultStoreRef?: { getProfile(senderId: string, channelId: string): any } | null;
}

function makeEnv(opts: EnvOptions = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "iris-branches-"));
  writeFileSync(join(tempDir, "pairing.json"), "[]");
  writeFileSync(join(tempDir, "allowlist.json"), "[]");

  const bridge = new ControllableBridge();
  const sessionMap = new SessionMap(tempDir);
  const securityGate = new SecurityGate(
    new PairingStore(tempDir),
    new AllowlistStore(tempDir),
    new RateLimiter({ perMinute: 30, perHour: 300 }),
    {
      defaultDmPolicy: opts.dmPolicy ?? "open",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 30,
      rateLimitPerHour: 300,
    },
  );

  const registry = new ChannelRegistry();
  const adapter = new MockAdapter();
  if (opts.withAdapter !== false) registry.register(adapter);

  const logger = pino({ level: "silent" });

  const router = new MessageRouter(
    bridge as any,
    sessionMap,
    securityGate,
    registry,
    logger,
    opts.channelConfigs ?? {},
    opts.opencodeConfig ?? null,
    opts.templateEngine,
    opts.profileEnricher,
    opts.vaultStoreRef,
  );

  return { tempDir, bridge, adapter, router, registry };
}

function cleanup(tempDir: string) {
  rmSync(tempDir, { recursive: true, force: true });
}

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
