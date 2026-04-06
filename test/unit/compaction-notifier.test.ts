import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompactionNotifier } from "../../src/bridge/compaction-notifier.js";
import type { SessionMap, SessionMapEntry } from "../../src/bridge/session-map.js";
import type { ChannelRegistry } from "../../src/channels/registry.js";
import type { IntelligenceStore } from "../../src/intelligence/store.js";
import type { Logger } from "../../src/logging/logger.js";
import type { ChannelAdapter } from "../../src/channels/adapter.js";

describe("CompactionNotifier", () => {
  let sessionMap: SessionMap;
  let registry: ChannelRegistry;
  let intelligenceStore: IntelligenceStore;
  let logger: Logger;
  let notifier: CompactionNotifier;
  let mockAdapter: ChannelAdapter;

  beforeEach(() => {
    // Mock SessionMap
    sessionMap = {
      findBySessionId: vi.fn(),
    } as unknown as SessionMap;

    // Mock ChannelAdapter
    mockAdapter = {
      sendText: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
    } as unknown as ChannelAdapter;

    // Mock ChannelRegistry
    registry = {
      get: vi.fn().mockReturnValue(mockAdapter),
    } as unknown as ChannelRegistry;

    // Mock IntelligenceStore
    intelligenceStore = {
      getActiveGoals: vi.fn().mockReturnValue([]),
      getActiveArcs: vi.fn().mockReturnValue([]),
    } as unknown as IntelligenceStore;

    // Mock Logger
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    notifier = new CompactionNotifier(sessionMap, registry, intelligenceStore, logger);
  });

  it("should skip notification when config disabled", async () => {
    const config = { enabled: false };
    await notifier.notify("session-123", "telegram", "chat-456", config);

    expect(logger.debug).toHaveBeenCalledWith(
      { sessionId: "session-123" },
      "Compaction notification disabled by config",
    );
    expect(mockAdapter.sendText).not.toHaveBeenCalled();
  });

  it("should send generic fallback when session not found", async () => {
    vi.mocked(sessionMap.findBySessionId).mockResolvedValue(null);

    const config = { enabled: true };
    await notifier.notify("session-123", "telegram", "chat-456", config);

    expect(logger.warn).toHaveBeenCalledWith(
      { sessionId: "session-123" },
      "Session not found in map — cannot resolve senderId",
    );
    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      to: "chat-456",
      text: "Context refreshed after compaction.",
    });
  });

  it("should send notification with goal and arc counts", async () => {
    const sessionEntry: SessionMapEntry = {
      openCodeSessionId: "session-123",
      channelId: "telegram",
      senderId: "user-789",
      chatId: "chat-456",
      chatType: "dm",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    vi.mocked(sessionMap.findBySessionId).mockResolvedValue(sessionEntry);

    vi.mocked(intelligenceStore.getActiveGoals).mockReturnValue([
      { id: "g1" } as any,
      { id: "g2" } as any,
    ]);
    vi.mocked(intelligenceStore.getActiveArcs).mockReturnValue([
      { id: "a1" } as any,
      { id: "a2" } as any,
      { id: "a3" } as any,
    ]);

    const config = { enabled: true };
    await notifier.notify("session-123", "telegram", "chat-456", config);

    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      to: "chat-456",
      text: "Context refreshed after compaction. Currently tracking: 2 active goals 3 memory arcs",
    });

    expect(logger.info).toHaveBeenCalledWith(
      { sessionId: "session-123", senderId: "user-789", goals: 2, arcs: 3 },
      "Compaction notification sent",
    );
  });

  it("should send notification with only goals when no arcs", async () => {
    const sessionEntry: SessionMapEntry = {
      openCodeSessionId: "session-123",
      channelId: "telegram",
      senderId: "user-789",
      chatId: "chat-456",
      chatType: "dm",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    vi.mocked(sessionMap.findBySessionId).mockResolvedValue(sessionEntry);

    vi.mocked(intelligenceStore.getActiveGoals).mockReturnValue([{ id: "g1" } as any]);
    vi.mocked(intelligenceStore.getActiveArcs).mockReturnValue([]);

    const config = { enabled: true };
    await notifier.notify("session-123", "telegram", "chat-456", config);

    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      to: "chat-456",
      text: "Context refreshed after compaction. Currently tracking: 1 active goal",
    });
  });

  it("should send notification with only arcs when no goals", async () => {
    const sessionEntry: SessionMapEntry = {
      openCodeSessionId: "session-123",
      channelId: "telegram",
      senderId: "user-789",
      chatId: "chat-456",
      chatType: "dm",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    vi.mocked(sessionMap.findBySessionId).mockResolvedValue(sessionEntry);

    vi.mocked(intelligenceStore.getActiveGoals).mockReturnValue([]);
    vi.mocked(intelligenceStore.getActiveArcs).mockReturnValue([{ id: "a1" } as any]);

    const config = { enabled: true };
    await notifier.notify("session-123", "telegram", "chat-456", config);

    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      to: "chat-456",
      text: "Context refreshed after compaction. Currently tracking: 1 memory arc",
    });
  });

  it("should send generic message when no goals or arcs", async () => {
    const sessionEntry: SessionMapEntry = {
      openCodeSessionId: "session-123",
      channelId: "telegram",
      senderId: "user-789",
      chatId: "chat-456",
      chatType: "dm",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    vi.mocked(sessionMap.findBySessionId).mockResolvedValue(sessionEntry);

    vi.mocked(intelligenceStore.getActiveGoals).mockReturnValue([]);
    vi.mocked(intelligenceStore.getActiveArcs).mockReturnValue([]);

    const config = { enabled: true };
    await notifier.notify("session-123", "telegram", "chat-456", config);

    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      to: "chat-456",
      text: "Context refreshed after compaction.",
    });
  });

  it("should handle intelligence store being null", async () => {
    const sessionEntry: SessionMapEntry = {
      openCodeSessionId: "session-123",
      channelId: "telegram",
      senderId: "user-789",
      chatId: "chat-456",
      chatType: "dm",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    vi.mocked(sessionMap.findBySessionId).mockResolvedValue(sessionEntry);

    const notifierWithoutIntelligence = new CompactionNotifier(
      sessionMap,
      registry,
      null,
      logger,
    );

    const config = { enabled: true };
    await notifierWithoutIntelligence.notify("session-123", "telegram", "chat-456", config);

    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      to: "chat-456",
      text: "Context refreshed after compaction.",
    });
  });

  it("should handle intelligence store errors gracefully", async () => {
    const sessionEntry: SessionMapEntry = {
      openCodeSessionId: "session-123",
      channelId: "telegram",
      senderId: "user-789",
      chatId: "chat-456",
      chatType: "dm",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    vi.mocked(sessionMap.findBySessionId).mockResolvedValue(sessionEntry);

    vi.mocked(intelligenceStore.getActiveGoals).mockImplementation(() => {
      throw new Error("Database error");
    });

    const config = { enabled: true };
    await notifier.notify("session-123", "telegram", "chat-456", config);

    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error), senderId: "user-789" },
      "Failed to fetch intelligence context for compaction notification",
    );

    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      to: "chat-456",
      text: "Context refreshed after compaction.",
    });
  });

  it("should warn when adapter not found", async () => {
    vi.mocked(registry.get).mockReturnValue(undefined);

    const config = { enabled: true };
    await notifier.notify("session-123", "telegram", "chat-456", config);

    expect(logger.warn).toHaveBeenCalledWith(
      { channelId: "telegram", sessionId: "session-123" },
      "No adapter found for compaction notification",
    );
    expect(mockAdapter.sendText).not.toHaveBeenCalled();
  });
});
