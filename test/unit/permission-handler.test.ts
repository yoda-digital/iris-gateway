import { describe, it, expect, vi, beforeEach } from "vitest";
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
    get: vi.fn().mockReturnValue(undefined),
    getOrCreate: vi.fn().mockResolvedValue("sess-1"),
    set: vi.fn(),
    delete: vi.fn(),
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

// ─── tests ───────────────────────────────────────────────────────────────────

describe("Permission handler — isAutoApproved", () => {
  it("auto-approves read-only permission types", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    // Simulate a permissionRequest event for a read-type
    // We do this via the EventHandler's emitter which is exposed through the constructor wiring
    // Instead we test the side-effect: approvePermission called with 'once'
    const perm = makePermission("file_read");

    // Trigger via internal event — access the event handler
    const eh = (router as unknown as { eventHandler: { events: { emit: (e: string, ...args: unknown[]) => void } } })
      .eventHandler;
    eh.events.emit("permissionRequest", "sess-1", perm);

    // Give the async handler a tick
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "once");
  });

  it("auto-approves list permission types", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    const perm = makePermission("list_directory");
    const eh = (router as unknown as { eventHandler: { events: { emit: (e: string, ...args: unknown[]) => void } } })
      .eventHandler;
    eh.events.emit("permissionRequest", "sess-1", perm);
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "once");
  });

  it("auto-approves search permission types", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    const perm = makePermission("search_files");
    const eh = (router as unknown as { eventHandler: { events: { emit: (e: string, ...args: unknown[]) => void } } })
      .eventHandler;
    eh.events.emit("permissionRequest", "sess-1", perm);
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "once");
  });
});

describe("Permission handler — isAutoDenied", () => {
  it("auto-denies doom_loop permission types", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    const perm = makePermission("doom_loop_spawn");
    const eh = (router as unknown as { eventHandler: { events: { emit: (e: string, ...args: unknown[]) => void } } })
      .eventHandler;
    eh.events.emit("permissionRequest", "sess-1", perm);
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });

  it("auto-denies external_directory permission types", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    const perm = makePermission("external_directory_access");
    const eh = (router as unknown as { eventHandler: { events: { emit: (e: string, ...args: unknown[]) => void } } })
      .eventHandler;
    eh.events.emit("permissionRequest", "sess-1", perm);
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });

  it("auto-denies when policyEngine marks permission as denied", async () => {
    const bridge = makeBridge();
    const policy = makePolicyEngine(true);
    const router = makeRouter(bridge, makeRegistry(), policy);

    const perm = makePermission("custom_write_op");
    const eh = (router as unknown as { eventHandler: { events: { emit: (e: string, ...args: unknown[]) => void } } })
      .eventHandler;
    eh.events.emit("permissionRequest", "sess-1", perm);
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });
});

describe("Permission handler — user routing", () => {
  it("routes unknown permissions to user when there is a pending context", async () => {
    const bridge = makeBridge();
    const sendText = vi.fn().mockResolvedValue(undefined);
    const registry = makeRegistry(sendText);

    const router = makeRouter(bridge, registry);

    // Inject a pending context for the session
    const turnGrouper = (router as unknown as { turnGrouper: { set: (id: string, v: unknown) => void } })
      .turnGrouper;
    turnGrouper.set("sess-1", { channelId: "ch1", chatId: "chat1" });

    const perm = makePermission("file_write");
    const eh = (router as unknown as { eventHandler: { events: { emit: (e: string, ...args: unknown[]) => void } } })
      .eventHandler;
    eh.events.emit("permissionRequest", "sess-1", perm);
    await new Promise((r) => setImmediate(r));

    // Should NOT auto-approve or auto-deny
    expect(bridge.approvePermission).not.toHaveBeenCalled();
    // Should notify the user via adapter
    expect(sendText).toHaveBeenCalled();
    const callArg = sendText.mock.calls[0][0] as { text: string };
    expect(callArg.text).toContain("permission");
  });

  it("auto-denies unknown permissions when no pending context", async () => {
    const bridge = makeBridge();
    const router = makeRouter(bridge, makeRegistry());

    // No pending context injected — turnGrouper returns undefined

    const perm = makePermission("file_write");
    const eh = (router as unknown as { eventHandler: { events: { emit: (e: string, ...args: unknown[]) => void } } })
      .eventHandler;
    eh.events.emit("permissionRequest", "sess-1", perm);
    await new Promise((r) => setImmediate(r));

    expect(bridge.approvePermission).toHaveBeenCalledWith("sess-1", "perm-1", "reject");
  });
});

describe("Permission handler — event-handler wiring", () => {
  it("emits permissionRequest for permission.updated events with valid sessionID and id", () => {
    const onPermissionRequest = vi.fn();
    const handler = new EventHandler(makeLogger());
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
    const handler = new EventHandler(makeLogger());
    handler.events.on("permissionRequest", onPermissionRequest);

    handler.handleEvent({ type: "permission.updated", properties: { type: "file_write" } } as unknown as import("../../src/bridge/opencode-client.js").OpenCodeEvent);

    expect(onPermissionRequest).not.toHaveBeenCalled();
  });
});
