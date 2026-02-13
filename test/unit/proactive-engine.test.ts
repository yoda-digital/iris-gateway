import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";
import { IntentStore } from "../../src/proactive/store.js";
import { PulseEngine } from "../../src/proactive/engine.js";
import type { ProactiveConfig } from "../../src/proactive/types.js";

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

function mockBridge() {
  return {
    createSession: vi.fn().mockResolvedValue({ id: "session-1" }),
    sendAndWait: vi.fn().mockResolvedValue("Follow-up response from AI"),
  };
}

function mockRouter() {
  return {
    sendResponse: vi.fn().mockResolvedValue(undefined),
  };
}

function mockSessionMap() {
  return {
    resolve: vi.fn().mockResolvedValue({
      openCodeSessionId: "session-1",
      channelId: "telegram",
      senderId: "user1",
      chatId: "chat1",
      chatType: "dm" as const,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }),
    findBySessionId: vi.fn().mockResolvedValue(null),
  };
}

function mockRegistry() {
  return {
    get: vi.fn().mockReturnValue({
      id: "telegram",
      sendText: vi.fn().mockResolvedValue({ messageId: "msg1" }),
    }),
    list: vi.fn().mockReturnValue([]),
  };
}

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: true,
  pollIntervalMs: 60_000,
  passiveScanIntervalMs: 21_600_000,
  softQuotas: { perUserPerDay: 3, globalPerDay: 100 },
  dormancy: { enabled: true, thresholdMs: 604_800_000 },
  intentDefaults: {
    minDelayMs: 3_600_000,
    maxAgeMs: 604_800_000,
    defaultConfidence: 0.8,
    confidenceThreshold: 0.5,
  },
  quietHours: { start: 22, end: 8 },
};

/** Return a timestamp at 14:00 today (well outside quiet hours 22–08). */
function noonishToday(): number {
  const d = new Date();
  d.setHours(14, 0, 0, 0);
  return d.getTime();
}

describe("PulseEngine", () => {
  let dir: string;
  let db: VaultDB;
  let vaultStore: VaultStore;
  let intentStore: IntentStore;
  let bridge: ReturnType<typeof mockBridge>;
  let router: ReturnType<typeof mockRouter>;
  let sessionMap: ReturnType<typeof mockSessionMap>;
  let registry: ReturnType<typeof mockRegistry>;
  let logger: ReturnType<typeof mockLogger>;
  let engine: PulseEngine;

  beforeEach(() => {
    // Fix time to 14:00 so we are never inside quiet hours (22–08)
    vi.useFakeTimers({ now: noonishToday() });

    dir = mkdtempSync(join(tmpdir(), "iris-pulse-"));
    db = new VaultDB(dir);
    vaultStore = new VaultStore(db);
    intentStore = new IntentStore(db);
    bridge = mockBridge();
    router = mockRouter();
    sessionMap = mockSessionMap();
    registry = mockRegistry();
    logger = mockLogger();
    engine = new PulseEngine({
      store: intentStore,
      bridge: bridge as any,
      router: router as any,
      sessionMap: sessionMap as any,
      vaultStore,
      registry: registry as any,
      logger: logger as any,
      config: DEFAULT_CONFIG,
    });
  });

  afterEach(() => {
    engine.stop();
    db.close();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts and stops without error", () => {
    engine.start();
    engine.stop();
    expect(logger.info).toHaveBeenCalledWith("Proactive pulse engine started");
  });

  it("processes a mature intent via tick()", async () => {
    vaultStore.upsertProfile({
      senderId: "user1",
      channelId: "telegram",
      name: "Alex",
    });

    intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "check if user fixed server",
      why: "user committed to fixing",
      confidence: 0.9,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(bridge.sendAndWait).toHaveBeenCalledTimes(1);
    const prompt = bridge.sendAndWait.mock.calls[0][1] as string;
    expect(prompt).toContain("check if user fixed server");

    expect(router.sendResponse).toHaveBeenCalledWith(
      "telegram",
      "chat1",
      "Follow-up response from AI",
    );
  });

  it("skips intents below confidence threshold", async () => {
    intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "low confidence",
      confidence: 0.3,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(bridge.sendAndWait).not.toHaveBeenCalled();
  });

  it("skips when AI responds with [SKIP]", async () => {
    bridge.sendAndWait.mockResolvedValueOnce("[SKIP]");

    intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "test skip",
      confidence: 0.9,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(bridge.sendAndWait).toHaveBeenCalledTimes(1);
    expect(router.sendResponse).not.toHaveBeenCalled();
  });

  it("respects soft quota", async () => {
    for (let i = 0; i < 3; i++) {
      intentStore.logProactiveMessage({
        senderId: "user1",
        channelId: "telegram",
        type: "intent",
        sourceId: `src${i}`,
      });
    }

    intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "should be quota blocked",
      confidence: 0.9,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(bridge.sendAndWait).not.toHaveBeenCalled();
  });

  it("processes triggers", async () => {
    vaultStore.upsertProfile({
      senderId: "user1",
      channelId: "telegram",
      name: "Alex",
    });

    intentStore.addTrigger({
      type: "dormant_user",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      context: "User inactive for 8 days",
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(bridge.sendAndWait).toHaveBeenCalledTimes(1);
    expect(router.sendResponse).toHaveBeenCalled();
  });

  it("handles [DEFER Xh] response", async () => {
    bridge.sendAndWait.mockResolvedValueOnce("[DEFER 6h]");

    const id = intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "defer me",
      confidence: 0.9,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(router.sendResponse).not.toHaveBeenCalled();
  });
});
