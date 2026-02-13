import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockAdapter } from "../helpers/mock-adapter.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";
import { makeInboundMessage } from "../helpers/fixtures.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { SessionMap } from "../../src/bridge/session-map.js";
import { MessageRouter } from "../../src/bridge/message-router.js";
import { SecurityGate } from "../../src/security/dm-policy.js";
import { PairingStore } from "../../src/security/pairing-store.js";
import { AllowlistStore } from "../../src/security/allowlist-store.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
  } as any;
}

describe("Integration: Message Pipeline", () => {
  let tempDir: string;
  let adapter: MockAdapter;
  let bridge: MockOpenCodeBridge;
  let registry: ChannelRegistry;
  let sessionMap: SessionMap;
  let router: MessageRouter;
  let logger: ReturnType<typeof mockLogger>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-integration-"));
    adapter = new MockAdapter("telegram", "Telegram");
    bridge = new MockOpenCodeBridge();
    registry = new ChannelRegistry();
    registry.register(adapter);
    sessionMap = new SessionMap(tempDir);
    logger = mockLogger();

    const pairingStore = new PairingStore(tempDir);
    const allowlistStore = new AllowlistStore(tempDir);
    const rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
    const securityGate = new SecurityGate(
      pairingStore,
      allowlistStore,
      rateLimiter,
      { defaultDmPolicy: "open", pairingCodeTtlMs: 3600000, pairingCodeLength: 8, rateLimitPerMinute: 30, rateLimitPerHour: 300 },
    );

    router = new MessageRouter(bridge as any, sessionMap, securityGate, registry, logger);
  });

  afterEach(() => {
    router.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("routes an inbound DM through the full pipeline", async () => {
    const msg = makeInboundMessage({
      channelId: "telegram",
      senderId: "alice",
      chatId: "alice-chat",
      text: "Hello Iris!",
    });

    await router.handleInbound(msg);

    // Should have sent typing indicator
    expect(adapter.calls.some((c) => c.method === "sendTyping")).toBe(true);

    // Should have created a session
    const entries = await sessionMap.list();
    expect(entries.length).toBe(1);
    expect(entries[0]!.channelId).toBe("telegram");
    expect(entries[0]!.senderId).toBe("alice");
  });

  it("reuses sessions for same sender", async () => {
    const msg1 = makeInboundMessage({ channelId: "telegram", senderId: "alice", chatId: "c1" });
    const msg2 = makeInboundMessage({ channelId: "telegram", senderId: "alice", chatId: "c1", id: "msg-2", text: "Second message" });

    await router.handleInbound(msg1);
    await router.handleInbound(msg2);

    const entries = await sessionMap.list();
    expect(entries.length).toBe(1); // Same session reused
  });

  it("creates separate sessions for different senders", async () => {
    const msg1 = makeInboundMessage({ channelId: "telegram", senderId: "alice", chatId: "c1" });
    const msg2 = makeInboundMessage({ channelId: "telegram", senderId: "bob", chatId: "c2", id: "msg-2" });

    await router.handleInbound(msg1);
    await router.handleInbound(msg2);

    const entries = await sessionMap.list();
    expect(entries.length).toBe(2);
  });

  it("sends response back via outbound queue when event fires", async () => {
    const msg = makeInboundMessage({ channelId: "telegram", senderId: "alice", chatId: "alice-chat" });
    await router.handleInbound(msg);

    // Get the session ID from session map
    const entries = await sessionMap.list();
    const sessionId = entries[0]!.openCodeSessionId;

    // Simulate a response event from OpenCode
    router.getEventHandler().events.emit("response", sessionId, "Hello Alice!");

    // Wait a tick for the queue to process
    await new Promise((r) => setTimeout(r, 50));

    // The response should have been queued and delivered
    const sendCalls = adapter.calls.filter((c) => c.method === "sendText");
    expect(sendCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Integration: Security Pipeline", () => {
  let tempDir: string;
  let adapter: MockAdapter;
  let bridge: MockOpenCodeBridge;
  let registry: ChannelRegistry;
  let router: MessageRouter;
  let pairingStore: PairingStore;
  let allowlistStore: AllowlistStore;
  let logger: ReturnType<typeof mockLogger>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-security-"));
    adapter = new MockAdapter("telegram", "Telegram");
    bridge = new MockOpenCodeBridge();
    registry = new ChannelRegistry();
    registry.register(adapter);
    logger = mockLogger();

    pairingStore = new PairingStore(tempDir);
    allowlistStore = new AllowlistStore(tempDir);
    const rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
    const securityGate = new SecurityGate(
      pairingStore,
      allowlistStore,
      rateLimiter,
      { defaultDmPolicy: "pairing", pairingCodeTtlMs: 3600000, pairingCodeLength: 8, rateLimitPerMinute: 30, rateLimitPerHour: 300 },
    );
    const sessionMap = new SessionMap(tempDir);

    router = new MessageRouter(bridge as any, sessionMap, securityGate, registry, logger);
  });

  afterEach(() => {
    router.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects unknown sender with pairing code", async () => {
    const msg = makeInboundMessage({ channelId: "telegram", senderId: "stranger", chatId: "stranger-chat" });
    await router.handleInbound(msg);

    // Should have sent a pairing message back
    const sendCalls = adapter.calls.filter((c) => c.method === "sendText");
    expect(sendCalls.length).toBe(1);
    const sentText = (sendCalls[0]!.args[0] as any).text as string;
    expect(sentText).toContain("pairing code");
  });

  it("allows approved sender through pairing flow", async () => {
    // First: unknown sender gets pairing code
    const msg1 = makeInboundMessage({ channelId: "telegram", senderId: "alice", chatId: "c1", senderName: "Alice" });
    await router.handleInbound(msg1);

    // Get the pairing code from the response
    const sendCalls1 = adapter.calls.filter((c) => c.method === "sendText");
    const sentText = (sendCalls1[0]!.args[0] as any).text as string;
    const codeMatch = sentText.match(/([A-Z2-9]{8})/);
    expect(codeMatch).toBeTruthy();
    const code = codeMatch![1]!;

    // Approve the code
    const approved = await pairingStore.approveCode(code);
    expect(approved).toBeTruthy();
    await allowlistStore.add(approved!.channelId, approved!.senderId, "test");

    // Now the same sender should get through
    adapter.calls.length = 0;
    const msg2 = makeInboundMessage({ channelId: "telegram", senderId: "alice", chatId: "c1", id: "msg-2", text: "I'm approved now!" });
    await router.handleInbound(msg2);

    // Should have sent typing (not a rejection)
    expect(adapter.calls.some((c) => c.method === "sendTyping")).toBe(true);
  });
});

describe("Integration: Media + Store Pipeline", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-media-int-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores, retrieves, and cleans up media", async () => {
    const { MediaStore } = await import("../../src/media/store.js");
    const store = new MediaStore(tempDir, 100); // 100ms TTL

    // Store a file
    const content = Buffer.from("test image data");
    const entry = await store.save(content, { filename: "test.jpg" });
    expect(entry.id).toBeDefined();
    expect(entry.mimeType).toBe("image/jpeg");

    // Retrieve it
    const data = await store.get(entry.id);
    expect(data).not.toBeNull();
    expect(data!.toString()).toBe("test image data");

    // Wait for TTL
    await new Promise((r) => setTimeout(r, 150));

    // Cleanup should remove it
    const removed = await store.cleanup();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await store.get(entry.id)).toBeNull();

    store.dispose();
  });
});

describe("Integration: Cron Store Persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-cron-int-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists and reloads cron jobs across instances", async () => {
    const { CronStore } = await import("../../src/cron/store.js");

    // Create store and add jobs
    const store1 = new CronStore(tempDir);
    await store1.add({
      name: "daily-check",
      schedule: "0 9 * * *",
      prompt: "Run health check",
      channel: "telegram",
      chatId: "123",
      enabled: true,
    });
    await store1.add({
      name: "weekly-report",
      schedule: "0 10 * * 1",
      prompt: "Generate weekly report",
      channel: "discord",
      chatId: "456",
      enabled: false,
    });

    // Create new store instance (simulating restart)
    const store2 = new CronStore(tempDir);
    const jobs = await store2.list();

    expect(jobs.length).toBe(2);
    expect(jobs.find((j) => j.name === "daily-check")?.enabled).toBe(true);
    expect(jobs.find((j) => j.name === "weekly-report")?.enabled).toBe(false);
  });
});
