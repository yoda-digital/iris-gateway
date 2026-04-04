/**
 * test/unit/permission-flow.test.ts
 *
 * Unit tests for the permission approval flow:
 *  - isAutoApproved / isAutoDenied logic
 *  - handlePermissionRequest: auto-approve, auto-deny (policy), auto-deny (no context)
 *  - handlePermissionRequest: inline buttons path
 *  - handlePermissionRequest: fallback text path (non-button channel)
 *  - MessageRouter /perm command handler: success (once + reject), ownership error, unknown session
 *  - EventHandler permission.updated event dispatch
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
import { EventHandler } from "../../src/bridge/event-handler.js";
import { MockAdapter } from "../helpers/mock-adapter.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";
import { makeInboundMessage } from "../helpers/fixtures.js";
import type { Permission } from "../../src/bridge/opencode-client.js";
import type { OpenCodeEvent } from "../../src/bridge/opencode-client.js";
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

class ControllableBridge extends MockOpenCodeBridge {
  readonly _cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 10_000 });
  override getCircuitBreaker() { return this._cb; }
  approvePermissionSpy = vi.spyOn(this, "approvePermission");
}

function makeEnv(opts: {
  inlineButtons?: boolean;
  policyEngine?: { isPermissionDenied(type: string): boolean } | null;
} = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "iris-perm-"));
  writeFileSync(join(tempDir, "pairing.json"), "[]");
  writeFileSync(join(tempDir, "allowlist.json"), "[]");

  const bridge = new ControllableBridge();
  const sessionMap = new SessionMap(tempDir);

  const securityGate = new SecurityGate(
    new PairingStore(tempDir),
    new AllowlistStore(tempDir),
    new RateLimiter({ perMinute: 30, perHour: 300 }),
    {
      defaultDmPolicy: "open",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 30,
      rateLimitPerHour: 300,
    },
  );

  const registry = new ChannelRegistry();
  const adapter = new MockAdapter("mock", "Mock");
  // Override capabilities to support or not support inlineButtons
  (adapter as any).capabilities = {
    ...(adapter as any).capabilities,
    inlineButtons: opts.inlineButtons ?? false,
  };
  registry.register(adapter);

  const logger = pino({ level: "silent" });

  const router = new MessageRouter(
    bridge as any,
    sessionMap,
    securityGate,
    registry,
    logger,
    {},
    opts.policyEngine ?? null,
  );

  return { tempDir, bridge, adapter, router, sessionMap };
}

function cleanup(tempDir: string) {
  rmSync(tempDir, { recursive: true, force: true });
}

// ── isAutoApproved / isAutoDenied (via handlePermissionRequest behavior) ──

describe("auto-approve logic", () => {
  it("auto-approves read_* permissions", async () => {
    const { tempDir, bridge, router } = makeEnv();
    try {
      // Trigger handlePermissionRequest via the event handler's permissionRequest event
      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "p1", sessionID: "s1", type: "read_file", title: "Read file" };
      eventHandler.events.emit("permissionRequest", "s1", perm);
      await new Promise(r => setTimeout(r, 20));
      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith("s1", "p1", "once");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("auto-approves list_* permissions", async () => {
    const { tempDir, bridge, router } = makeEnv();
    try {
      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "p2", sessionID: "s2", type: "list_directory", title: "List dir" };
      eventHandler.events.emit("permissionRequest", "s2", perm);
      await new Promise(r => setTimeout(r, 20));
      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith("s2", "p2", "once");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("auto-approves search_* permissions", async () => {
    const { tempDir, bridge, router } = makeEnv();
    try {
      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "p3", sessionID: "s3", type: "search_codebase", title: "Search" };
      eventHandler.events.emit("permissionRequest", "s3", perm);
      await new Promise(r => setTimeout(r, 20));
      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith("s3", "p3", "once");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("does NOT auto-approve read_credentials (not in allowlist despite read prefix)", async () => {
    const { tempDir, bridge, router } = makeEnv();
    try {
      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "p-cred", sessionID: "s-cred", type: "read_credentials", title: "Read creds" };
      eventHandler.events.emit("permissionRequest", "s-cred", perm);
      await new Promise(r => setTimeout(r, 20));
      // No pending context → auto-deny (it is NOT in the allowlist)
      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith("s-cred", "p-cred", "reject");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("does NOT auto-approve write_file (non-read/list/search)", async () => {
    const { tempDir, bridge, router } = makeEnv();
    try {
      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "p4", sessionID: "s4", type: "write_file", title: "Write" };
      eventHandler.events.emit("permissionRequest", "s4", perm);
      await new Promise(r => setTimeout(r, 20));
      // No pending context → auto-deny for safety
      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith("s4", "p4", "reject");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

describe("auto-deny logic", () => {
  it("auto-denies doom_loop permission type", async () => {
    const { tempDir, bridge, router } = makeEnv();
    try {
      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "p5", sessionID: "s5", type: "doom_loop", title: "Doom" };
      eventHandler.events.emit("permissionRequest", "s5", perm);
      await new Promise(r => setTimeout(r, 20));
      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith("s5", "p5", "reject");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("auto-denies permissions rejected by policyEngine", async () => {
    const policyEngine = { isPermissionDenied: (type: string) => type === "exec_shell" };
    const { tempDir, bridge, router } = makeEnv({ policyEngine });
    try {
      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "p6", sessionID: "s6", type: "exec_shell", title: "Shell" };
      eventHandler.events.emit("permissionRequest", "s6", perm);
      await new Promise(r => setTimeout(r, 20));
      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith("s6", "p6", "reject");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("auto-denies when no pending context (no session turn in flight)", async () => {
    const { tempDir, bridge, router } = makeEnv();
    try {
      const eventHandler = router.getEventHandler();
      // write_file is not auto-approved/denied by type, but there is no pending turn context
      const perm: Permission = { id: "p7", sessionID: "no-context-session", type: "write_file", title: "Write" };
      eventHandler.events.emit("permissionRequest", "no-context-session", perm);
      await new Promise(r => setTimeout(r, 20));
      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith("no-context-session", "p7", "reject");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

describe("handlePermissionRequest — inline buttons path", () => {
  it("sends inline button message when adapter has inlineButtons capability and context exists", async () => {
    const { tempDir, bridge, adapter, router } = makeEnv({ inlineButtons: true });
    try {
      // Simulate an in-flight session by pushing to turnGrouper manually via getEventHandler
      // We access the turnGrouper indirectly by seeding a fake turn through router internals.
      // Since getTurnGrouper() returns the grouper, we can set a fake pending entry.
      const turnGrouper = router.getTurnGrouper();
      turnGrouper.set("session-inline", { channelId: "mock", chatId: "chat-1", replyToId: "msg-1" });

      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "btn-perm", sessionID: "session-inline", type: "write_file", title: "Write file" };
      eventHandler.events.emit("permissionRequest", "session-inline", perm);
      await new Promise(r => setTimeout(r, 30));

      // Should NOT have called approvePermission (deferred to user)
      expect(bridge.approvePermissionSpy).not.toHaveBeenCalled();

      // Should have sent a message with inline buttons
      const sentCall = adapter.calls.find(c => c.method === "sendText");
      expect(sentCall).toBeDefined();
      const params = sentCall!.args[0] as any;
      expect(params.buttons).toBeDefined();
      expect(params.buttons.length).toBeGreaterThan(0);
      expect(params.parseMode).toBe("Markdown");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

describe("handlePermissionRequest — adapter not found (silent hang prevention)", () => {
  it("auto-denies when pending context exists but adapter is missing from registry", async () => {
    const { tempDir, bridge, router } = makeEnv();
    try {
      const turnGrouper = router.getTurnGrouper();
      // Register a pending context for a channel that is NOT in the registry
      turnGrouper.set("session-no-adapter", { channelId: "nonexistent-channel", chatId: "chat-1", replyToId: "msg-1" });

      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "hang-perm", sessionID: "session-no-adapter", type: "write_file", title: "Write file" };
      eventHandler.events.emit("permissionRequest", "session-no-adapter", perm);
      await new Promise(r => setTimeout(r, 30));

      // Should auto-deny to prevent the AI turn from hanging permanently
      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith("session-no-adapter", "hang-perm", "reject");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

describe("handlePermissionRequest — fallback text path", () => {
  it("sends fallback /perm instructions when adapter lacks inlineButtons", async () => {
    const { tempDir, bridge, adapter, router } = makeEnv({ inlineButtons: false });
    try {
      const turnGrouper = router.getTurnGrouper();
      turnGrouper.set("session-fallback", { channelId: "mock", chatId: "chat-1", replyToId: "msg-1" });

      const eventHandler = router.getEventHandler();
      const perm: Permission = { id: "fb-perm", sessionID: "session-fallback", type: "write_file", title: "Write file" };
      eventHandler.events.emit("permissionRequest", "session-fallback", perm);
      await new Promise(r => setTimeout(r, 30));

      expect(bridge.approvePermissionSpy).not.toHaveBeenCalled();

      const sentCall = adapter.calls.find(c => c.method === "sendText");
      expect(sentCall).toBeDefined();
      const params = sentCall!.args[0] as any;
      expect(params.text).toContain("/perm once");
      expect(params.text).toContain("session-fallback");
      expect(params.text).toContain("fb-perm");
      expect(params.parseMode).toBe("Markdown");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

// ── /perm command handler ──────────────────────────────────────────────────

describe("MessageRouter /perm command handler", () => {
  it("approves once when session ownership matches", async () => {
    const { tempDir, bridge, adapter, router, sessionMap } = makeEnv();
    try {
      // Seed a session in the session map owned by "user-1"
      await sessionMap.resolve("mock", "user-1", "chat-1", "dm", bridge as any);
      const entries = await sessionMap.list();
      const entry = entries[0]!;
      const sessionId = entry.openCodeSessionId;

      const msg = makeInboundMessage({
        text: `/perm once ${sessionId} perm-id-99`,
        senderId: "user-1",
        chatId: "chat-1",
      });
      await router.handleInbound(msg);

      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith(sessionId, "perm-id-99", "once");
      const confirmCall = adapter.calls.find(c => c.method === "sendText");
      expect(confirmCall).toBeDefined();
      const params = confirmCall!.args[0] as any;
      expect(params.text).toContain("✅");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("rejects when session belongs to a different user", async () => {
    const { tempDir, bridge, adapter, router, sessionMap } = makeEnv();
    try {
      // Seed session owned by "user-1"
      await sessionMap.resolve("mock", "user-1", "chat-1", "dm", bridge as any);
      const entries = await sessionMap.list();
      const sessionId = entries[0]!.openCodeSessionId;

      // user-2 attempts to approve user-1's session
      const msg = makeInboundMessage({
        text: `/perm once ${sessionId} perm-id-99`,
        senderId: "user-2",
        chatId: "chat-2",
      });
      await router.handleInbound(msg);

      expect(bridge.approvePermissionSpy).not.toHaveBeenCalled();
      const sentCall = adapter.calls.find(c => c.method === "sendText");
      expect(sentCall).toBeDefined();
      const params = sentCall!.args[0] as any;
      expect(params.text).toContain("does not belong to you");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("rejects when sessionId is unknown", async () => {
    const { tempDir, bridge, adapter, router } = makeEnv();
    try {
      const msg = makeInboundMessage({
        text: `/perm once unknown-session-xyz perm-id-99`,
        senderId: "user-1",
      });
      await router.handleInbound(msg);

      expect(bridge.approvePermissionSpy).not.toHaveBeenCalled();
      const sentCall = adapter.calls.find(c => c.method === "sendText");
      expect(sentCall).toBeDefined();
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });

  it("handles reject action", async () => {
    const { tempDir, bridge, adapter, router, sessionMap } = makeEnv();
    try {
      await sessionMap.resolve("mock", "user-1", "chat-1", "dm", bridge as any);
      const entries = await sessionMap.list();
      const sessionId = entries[0]!.openCodeSessionId;

      const msg = makeInboundMessage({
        text: `/perm reject ${sessionId} perm-id-77`,
        senderId: "user-1",
        chatId: "chat-1",
      });
      await router.handleInbound(msg);

      expect(bridge.approvePermissionSpy).toHaveBeenCalledWith(sessionId, "perm-id-77", "reject");
      const sentCall = adapter.calls.find(c => c.method === "sendText");
      const params = sentCall!.args[0] as any;
      expect(params.text).toContain("❌");
    } finally {
      router.dispose();
      cleanup(tempDir);
    }
  });
});

// ── EventHandler permission.updated event ──────────────────────────────────

describe("EventHandler — permission.updated event", () => {
  let handler: EventHandler;

  afterEach(() => {
    handler?.dispose();
  });

  it("emits permissionRequest with correct Permission object", () => {
    handler = new EventHandler();
    const onPermission = vi.fn();
    handler.events.on("permissionRequest", onPermission);

    const event: OpenCodeEvent = {
      type: "permission.updated",
      properties: {
        sessionID: "sess-abc",
        id: "perm-xyz",
        type: "write_file",
        title: "Write file",
      },
    } as unknown as OpenCodeEvent;

    handler.handleEvent(event);

    expect(onPermission).toHaveBeenCalledWith("sess-abc", {
      id: "perm-xyz",
      sessionID: "sess-abc",
      type: "write_file",
      title: "Write file",
    });
  });

  it("does not emit permissionRequest when sessionID is missing", () => {
    handler = new EventHandler();
    const onPermission = vi.fn();
    handler.events.on("permissionRequest", onPermission);

    const event: OpenCodeEvent = {
      type: "permission.updated",
      properties: {
        id: "perm-xyz",
        type: "write_file",
      },
    } as unknown as OpenCodeEvent;

    handler.handleEvent(event);

    expect(onPermission).not.toHaveBeenCalled();
  });

  it("does not emit permissionRequest when id is missing", () => {
    handler = new EventHandler();
    const onPermission = vi.fn();
    handler.events.on("permissionRequest", onPermission);

    const event: OpenCodeEvent = {
      type: "permission.updated",
      properties: {
        sessionID: "sess-abc",
        type: "write_file",
      },
    } as unknown as OpenCodeEvent;

    handler.handleEvent(event);

    expect(onPermission).not.toHaveBeenCalled();
  });

  it("does not emit permissionRequest when metadata.status is not pending", () => {
    handler = new EventHandler();
    const onPermission = vi.fn();
    handler.events.on("permissionRequest", onPermission);

    const event: OpenCodeEvent = {
      type: "permission.updated",
      properties: {
        sessionID: "sess-abc",
        id: "perm-xyz",
        type: "write_file",
        title: "Write file",
        metadata: { status: "approved" },
      },
    } as unknown as OpenCodeEvent;

    handler.handleEvent(event);

    expect(onPermission).not.toHaveBeenCalled();
  });

  it("emits permissionRequest when metadata.status is pending", () => {
    handler = new EventHandler();
    const onPermission = vi.fn();
    handler.events.on("permissionRequest", onPermission);

    const event: OpenCodeEvent = {
      type: "permission.updated",
      properties: {
        sessionID: "sess-abc",
        id: "perm-xyz",
        type: "write_file",
        title: "Write file",
        metadata: { status: "pending" },
      },
    } as unknown as OpenCodeEvent;

    handler.handleEvent(event);

    expect(onPermission).toHaveBeenCalledWith("sess-abc", {
      id: "perm-xyz",
      sessionID: "sess-abc",
      type: "write_file",
      title: "Write file",
    });
  });
});
