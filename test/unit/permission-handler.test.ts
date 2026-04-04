import { describe, it, expect, vi } from "vitest";
import { EventHandler } from "../../src/bridge/event-handler.js";
import type { Permission } from "../../src/bridge/opencode-client.js";
import type { OpenCodeBridge } from "../../src/bridge/opencode-client.js";
import type { ChannelRegistry } from "../../src/channels/registry.js";
import type { SecurityGate } from "../../src/security/dm-policy.js";
import type { Logger } from "../../src/logging/logger.js";
import type { PolicyEngine } from "../../src/governance/policy.js";
import type { SessionMap } from "../../src/bridge/session-map.js";
import { MessageRouter } from "../../src/bridge/message-router.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makePermission(type: string, overrides: Partial<Permission> = {}): Permission {
  return {
    id: "perm-1",
    sessionID: "sess-1",
    type,
    title: `Permission: ${type}`,
    ...overrides,
  } as Permission;
}

function makeLogger(): Logger {
  return {
    child: () => makeLogger(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  } as unknown as Logger;
}

function makeBridge(): OpenCodeBridge {
  return {
    approvePermission: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(""),
    sendAndWait: vi.fn().mockResolvedValue(""),
    ensureSession: vi.fn().mockResolvedValue("sess-1"),
    subscribeToSession: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
  } as unknown as OpenCodeBridge;
}

function makeRegistry(adapterSendText?: ReturnType<typeof vi.fn>): ChannelRegistry {
  const send = adapterSendText ?? vi.fn().mockResolvedValue(undefined);
  return {
    get: vi.fn().mockReturnValue({ sendText: send }),
  } as unknown as ChannelRegistry;
}

function makePolicyEngine(denied = false): PolicyEngine {
  return {
    isPermissionDenied: vi.fn().mockReturnValue(denied),
  } as unknown as PolicyEngine;
}

function makeSecurityGate(): SecurityGate {
  return {
    check: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as SecurityGate;
}

function makeSessionMap(): SessionMap {
  return {
    resolve: vi.fn().mockResolvedValue({ openCodeSessionId: "sess-1", channelId: "ch1", senderId: "u1", chatId: "chat1", chatType: "dm", createdAt: 0, lastActiveAt: 0 }),
    buildKey: vi.fn().mockReturnValue("ch1:dm:chat1"),
    reset: vi.fn().mockResolvedValue(undefined),
    findBySessionId: vi.fn().mockResolvedValue(null),
  } as unknown as SessionMap;
}

function makeRouter(
  bridge: OpenCodeBridge,
  registry: ChannelRegistry,
  policyEngine?: PolicyEngine,
): MessageRouter {
  return new MessageRouter(
    bridge,
    makeSessionMap(),
    makeSecurityGate(),
    registry,
    makeLogger(),
    {},
    undefined,
    policyEngine,
  );
}

// Helper: emit a permissionRequest via the public EventHandler accessor
function emitPermission(router: MessageRouter, sessionId: string, perm: Permission): void {
  router.getEventHandler().events.emit("permissionRequest", sessionId, perm);
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("Permission handler — isAutoApproved", () => {
  it("auto-approves read-only operations (e.g. file_read)", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    emitPermission(router, "sess-1", makePermission("file_read"));
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "once");
  });

  it("auto-approves directory listing operations (e.g. list_directory)", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    emitPermission(router, "sess-1", makePermission("list_directory"));
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "once");
  });

  it("auto-approves search operations (e.g. search_files)", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    emitPermission(router, "sess-1", makePermission("search_files"));
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "once");
  });

  it("auto-approves operations ending in _search suffix (e.g. web_search)", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    emitPermission(router, "sess-1", makePermission("web_search"));
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "once");
  });
});

describe("Permission handler — isAutoDenied", () => {
  it("auto-denies shell execution (bash)", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    emitPermission(router, "sess-1", makePermission("bash"));
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });

  it("auto-denies file editing (edit)", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    emitPermission(router, "sess-1", makePermission("edit"));
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });

  it("auto-denies when policyEngine marks permission as denied", async () => {
    const bridge = makeBridge();
    const policy = makePolicyEngine(true);
    const router = makeRouter(bridge, makeRegistry(), policy);

    emitPermission(router, "sess-1", makePermission("custom_write_op"));
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });

  it("policy deny overrides auto-approve — policy is the structural ceiling", async () => {
    const bridge = makeBridge();
    // policyEngine denies 'read' type — must win over isAutoApproved
    const policy = makePolicyEngine(true);
    const router = makeRouter(bridge, makeRegistry(), policy);

    emitPermission(router, "sess-1", makePermission("read_files"));
    await new Promise((r) => setImmediate(r));

    // Should be rejected, NOT approved, even though read_files matches isAutoApproved
    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });
});

describe("Permission handler — user routing", () => {
  it("routes unknown permissions to user when there is a pending context, then rejects to prevent deadlock", async () => {
    const bridge = makeBridge();
    const sendText = vi.fn().mockResolvedValue(undefined);
    const registry = makeRegistry(sendText);

    const router = makeRouter(bridge, registry);

    // Inject a pending context for the session via the public accessor
    router.getTurnGrouper().set("sess-1", { channelId: "ch1", chatId: "chat1" });

    emitPermission(router, "sess-1", makePermission("file_write"));
    await new Promise((r) => setImmediate(r));

    // Should notify the user via adapter
    expect(sendText).toHaveBeenCalled();
    const callArg = sendText.mock.calls[0][0] as { text: string };
    expect(callArg.text).toContain("permission");
    // Must also reject to prevent OpenCode session deadlock (no response handler implemented)
    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });

  it("auto-denies unknown permissions when no pending context", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    // No pending context injected — turnGrouper returns undefined
    emitPermission(router, "sess-1", makePermission("file_write"));
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });

  it("calls approvePermission(reject) even when adapter.sendText throws — prevents session deadlock", async () => {
    const bridge = makeBridge();
    const sendText = vi.fn().mockRejectedValue(new Error("adapter unavailable"));
    const registry = makeRegistry(sendText);

    const router = makeRouter(bridge, registry);
    router.getTurnGrouper().set("sess-1", { channelId: "ch1", chatId: "chat1" });

    emitPermission(router, "sess-1", makePermission("file_write"));
    await new Promise((r) => setImmediate(r));

    // approvePermission must still be called via finally, even though sendText threw
    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });
});

describe("Permission handler — event-handler wiring", () => {
  it("emits permissionRequest for permission.updated events with valid sessionID and id", () => {
    const onPermissionRequest = vi.fn();
    const handler = new EventHandler();
    handler.events.on("permissionRequest", onPermissionRequest);

    handler.handleEvent({
      type: "permission.updated",
      properties: {
        sessionID: "sess-1",
        id: "perm-1",
        type: "file_write",
        title: "Write to file",
      },
    } as unknown as import("../../src/bridge/opencode-client.js").OpenCodeEvent);

    expect(onPermissionRequest).toHaveBeenCalledWith("sess-1", expect.objectContaining({ id: "perm-1" }));
  });

  it("ignores permission.updated events missing sessionID or id", () => {
    const onPermissionRequest = vi.fn();
    const handler = new EventHandler();
    handler.events.on("permissionRequest", onPermissionRequest);

    handler.handleEvent({ type: "permission.updated", properties: { type: "file_write" } } as unknown as import("../../src/bridge/opencode-client.js").OpenCodeEvent);

    expect(onPermissionRequest).not.toHaveBeenCalled();
  });
});
