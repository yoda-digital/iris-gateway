import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { MockAdapter } from "../helpers/mock-adapter.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";
import { makeInboundMessage } from "../helpers/fixtures.js";
import type { Permission } from "../../src/bridge/opencode-client.js";
import pino from "pino";

function makePermission(type: string, overrides: Partial<Permission> = {}): Permission {
  return {
    id: "perm-1",
    sessionID: "session-1",
    type,
    title: `Permission: ${type}`,
    pattern: undefined,
    messageID: "msg-1",
    metadata: {},
    time: { created: Date.now() },
    ...overrides,
  } as Permission;
}

describe("MessageRouter", () => {
  let tempDir: string;
  let router: MessageRouter;
  let adapter: MockAdapter;
  let bridge: MockOpenCodeBridge;
  let registry: ChannelRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-test-"));
    writeFileSync(join(tempDir, "pairing.json"), "[]");
    writeFileSync(join(tempDir, "allowlist.json"), "[]");

    bridge = new MockOpenCodeBridge();
    const sessionMap = new SessionMap(tempDir);
    const pairingStore = new PairingStore(tempDir);
    const allowlistStore = new AllowlistStore(tempDir);
    const rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
    const securityGate = new SecurityGate(pairingStore, allowlistStore, rateLimiter, {
      defaultDmPolicy: "open",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 30,
      rateLimitPerHour: 300,
    });

    registry = new ChannelRegistry();
    adapter = new MockAdapter();
    registry.register(adapter);

    const logger = pino({ level: "silent" });

    router = new MessageRouter(
      bridge as any,
      sessionMap,
      securityGate,
      registry,
      logger,
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("routes inbound message through pipeline", async () => {
    const msg = makeInboundMessage({ channelId: "mock" });
    await router.handleInbound(msg);

    // Should have sent typing indicator
    const typingCalls = adapter.calls.filter((c) => c.method === "sendTyping");
    expect(typingCalls.length).toBe(1);
  });

  it("sends response to correct channel", async () => {
    await router.sendResponse("mock", "chat-1", "Hello!", "msg-1");

    const sendCalls = adapter.calls.filter((c) => c.method === "sendText");
    expect(sendCalls.length).toBe(1);
    expect((sendCalls[0]!.args[0] as any).text).toBe("Hello!");
    expect((sendCalls[0]!.args[0] as any).to).toBe("chat-1");
  });

  it("chunks long responses", async () => {
    const longText = "word ".repeat(1000);
    await router.sendResponse("mock", "chat-1", longText);

    const sendCalls = adapter.calls.filter((c) => c.method === "sendText");
    expect(sendCalls.length).toBeGreaterThan(1);
  });

  it("rejects messages in disabled mode", async () => {
    // Create a new router with disabled policy
    const pairingStore = new PairingStore(tempDir);
    const allowlistStore = new AllowlistStore(tempDir);
    const rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
    const disabledGate = new SecurityGate(pairingStore, allowlistStore, rateLimiter, {
      defaultDmPolicy: "disabled",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 30,
      rateLimitPerHour: 300,
    });

    const disabledRouter = new MessageRouter(
      bridge as any,
      new SessionMap(tempDir),
      disabledGate,
      registry,
      pino({ level: "silent" }),
    );

    const msg = makeInboundMessage({ channelId: "mock" });
    await disabledRouter.handleInbound(msg);

    // Should have sent rejection message, no typing indicator
    const sendCalls = adapter.calls.filter((c) => c.method === "sendText");
    expect(sendCalls.length).toBe(1);
    expect((sendCalls[0]!.args[0] as any).text).toContain("disabled");
  });
  it("forwards sendAndWaitTimeoutMs from channel config to bridge.sendAndWait", async () => {
    // Spy on sendAndWait to capture the timeoutMs argument
    let capturedTimeoutMs: number | undefined;
    const origSendAndWait = bridge.sendAndWait.bind(bridge);
    bridge.sendAndWait = async (sessionId, text, timeoutMs) => {
      capturedTimeoutMs = timeoutMs;
      return origSendAndWait(sessionId, text, timeoutMs);
    };

    // Build a router with sendAndWaitTimeoutMs configured for "mock" channel
    const pairingStore2 = new PairingStore(tempDir);
    const allowlistStore2 = new AllowlistStore(tempDir);
    const rateLimiter2 = new RateLimiter({ perMinute: 30, perHour: 300 });
    const securityGate2 = new SecurityGate(pairingStore2, allowlistStore2, rateLimiter2, {
      defaultDmPolicy: "open",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 30,
      rateLimitPerHour: 300,
    });

    const routerWithTimeout = new MessageRouter(
      bridge as any,
      new SessionMap(tempDir),
      securityGate2,
      registry,
      pino({ level: "silent" }),
      { mock: { sendAndWaitTimeoutMs: 30_000 } },
    );

    const msg = makeInboundMessage({ channelId: "mock" });
    await routerWithTimeout.handleInbound(msg);

    expect(capturedTimeoutMs).toBe(30_000);
  });

  it("passes undefined to bridge.sendAndWait when sendAndWaitTimeoutMs is not configured", async () => {
    let capturedTimeoutMs: number | undefined = 99999;
    const origSendAndWait = bridge.sendAndWait.bind(bridge);
    bridge.sendAndWait = async (sessionId: string, text: string, timeoutMs?: number) => {
      capturedTimeoutMs = timeoutMs;
      return origSendAndWait(sessionId, text, timeoutMs);
    };

    // router (created in beforeEach) has no channelConfigs — timeout should be undefined
    const msg = makeInboundMessage({ channelId: 'mock' });
    await router.handleInbound(msg);

    expect(capturedTimeoutMs).toBeUndefined();
  });
})

describe("MessageRouter — isAutoApproved", () => {
  let tempDir: string;
  let bridge: MockOpenCodeBridge;
  let router: MessageRouter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-perm-test-"));
    writeFileSync(join(tempDir, "pairing.json"), "[]");
    writeFileSync(join(tempDir, "allowlist.json"), "[]");
    bridge = new MockOpenCodeBridge();
    const sessionMap = new SessionMap(tempDir);
    const pairingStore = new PairingStore(tempDir);
    const allowlistStore = new AllowlistStore(tempDir);
    const rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
    const securityGate = new SecurityGate(pairingStore, allowlistStore, rateLimiter, {
      defaultDmPolicy: "open", pairingCodeTtlMs: 3_600_000, pairingCodeLength: 8,
      rateLimitPerMinute: 30, rateLimitPerHour: 300,
    });
    router = new MessageRouter(bridge as any, sessionMap, securityGate, new ChannelRegistry(), pino({ level: "silent" }));
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("approves exact 'read' type", () => {
    expect((router as any).isAutoApproved(makePermission("read"))).toBe(true);
  });

  it("approves exact 'list' type", () => {
    expect((router as any).isAutoApproved(makePermission("list"))).toBe(true);
  });

  it("approves exact 'search' type", () => {
    expect((router as any).isAutoApproved(makePermission("search"))).toBe(true);
  });

  it("does NOT approve 'external_read' (no substring matching)", () => {
    expect((router as any).isAutoApproved(makePermission("external_read"))).toBe(false);
  });

  it("does NOT approve 'bulk_search_egress' (no substring matching)", () => {
    expect((router as any).isAutoApproved(makePermission("bulk_search_egress"))).toBe(false);
  });

  it("does NOT approve 'bash'", () => {
    expect((router as any).isAutoApproved(makePermission("bash"))).toBe(false);
  });

  it("does NOT approve 'edit'", () => {
    expect((router as any).isAutoApproved(makePermission("edit"))).toBe(false);
  });
});

describe("MessageRouter — isAutoDenied", () => {
  let tempDir: string;
  let bridge: MockOpenCodeBridge;
  let router: MessageRouter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-perm-test-"));
    writeFileSync(join(tempDir, "pairing.json"), "[]");
    writeFileSync(join(tempDir, "allowlist.json"), "[]");
    bridge = new MockOpenCodeBridge();
    const sessionMap = new SessionMap(tempDir);
    const pairingStore = new PairingStore(tempDir);
    const allowlistStore = new AllowlistStore(tempDir);
    const rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
    const securityGate = new SecurityGate(pairingStore, allowlistStore, rateLimiter, {
      defaultDmPolicy: "open", pairingCodeTtlMs: 3_600_000, pairingCodeLength: 8,
      rateLimitPerMinute: 30, rateLimitPerHour: 300,
    });
    router = new MessageRouter(bridge as any, sessionMap, securityGate, new ChannelRegistry(), pino({ level: "silent" }));
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("denies 'bash' when no policyEngine", () => {
    expect((router as any).isAutoDenied(makePermission("bash"))).toBe(true);
  });

  it("denies 'edit' when no policyEngine", () => {
    expect((router as any).isAutoDenied(makePermission("edit"))).toBe(true);
  });

  it("does NOT deny 'read' when no policyEngine", () => {
    expect((router as any).isAutoDenied(makePermission("read"))).toBe(false);
  });

  it("does NOT deny speculative/unknown types when no policyEngine", () => {
    expect((router as any).isAutoDenied(makePermission("network_egress"))).toBe(false);
    expect((router as any).isAutoDenied(makePermission("doom_loop"))).toBe(false);
  });

  it("delegates to policyEngine when present", () => {
    const policyEngine = { isPermissionDenied: (t: string) => t === "bash" };
    const td = mkdtempSync(join(tmpdir(), "iris-perm-policy-"));
    writeFileSync(join(td, "pairing.json"), "[]");
    writeFileSync(join(td, "allowlist.json"), "[]");
    const pairingStore = new PairingStore(td);
    const allowlistStore = new AllowlistStore(td);
    const rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
    const securityGate = new SecurityGate(pairingStore, allowlistStore, rateLimiter, {
      defaultDmPolicy: "open", pairingCodeTtlMs: 3_600_000, pairingCodeLength: 8,
      rateLimitPerMinute: 30, rateLimitPerHour: 300,
    });
    const r = new MessageRouter(
      bridge as any, new SessionMap(td), securityGate, new ChannelRegistry(),
      pino({ level: "silent" }), {}, null, null, null, policyEngine as any,
    );
    try {
      expect((r as any).isAutoDenied(makePermission("bash"))).toBe(true);
      expect((r as any).isAutoDenied(makePermission("read"))).toBe(false);
    } finally {
      rmSync(td, { recursive: true, force: true });
    }
  });
});

describe("MessageRouter — handlePermissionRequest", () => {
  let tempDir: string;
  let bridge: MockOpenCodeBridge;
  let router: MessageRouter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-perm-test-"));
    writeFileSync(join(tempDir, "pairing.json"), "[]");
    writeFileSync(join(tempDir, "allowlist.json"), "[]");
    bridge = new MockOpenCodeBridge();
    const sessionMap = new SessionMap(tempDir);
    const pairingStore = new PairingStore(tempDir);
    const allowlistStore = new AllowlistStore(tempDir);
    const rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
    const securityGate = new SecurityGate(pairingStore, allowlistStore, rateLimiter, {
      defaultDmPolicy: "open", pairingCodeTtlMs: 3_600_000, pairingCodeLength: 8,
      rateLimitPerMinute: 30, rateLimitPerHour: 300,
    });
    router = new MessageRouter(bridge as any, sessionMap, securityGate, new ChannelRegistry(), pino({ level: "silent" }));
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("auto-approves read-only permissions", async () => {
    await (router as any).handlePermissionRequest("session-1", makePermission("read"));
    expect(bridge.permissionDecisions).toEqual([
      { sessionId: "session-1", permissionId: "perm-1", response: "once" },
    ]);
  });

  it("auto-denies bash permissions", async () => {
    await (router as any).handlePermissionRequest("session-1", makePermission("bash"));
    expect(bridge.permissionDecisions).toEqual([
      { sessionId: "session-1", permissionId: "perm-1", response: "reject" },
    ]);
  });

  it("auto-denies edit permissions", async () => {
    await (router as any).handlePermissionRequest("session-1", makePermission("edit"));
    expect(bridge.permissionDecisions).toEqual([
      { sessionId: "session-1", permissionId: "perm-1", response: "reject" },
    ]);
  });

  it("auto-denies unknown permission types by default", async () => {
    await (router as any).handlePermissionRequest("session-1", makePermission("unknown_custom_type"));
    expect(bridge.permissionDecisions).toEqual([
      { sessionId: "session-1", permissionId: "perm-1", response: "reject" },
    ]);
  });
})
