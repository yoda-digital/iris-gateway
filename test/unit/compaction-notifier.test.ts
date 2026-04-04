import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompactionNotifier } from "../../src/bridge/compaction-notifier.js";
import type { GoalLifecycle } from "../../src/intelligence/goals/lifecycle.js";
import type { ArcLifecycle } from "../../src/intelligence/arcs/lifecycle.js";
import type { ChannelRegistry } from "../../src/channels/registry.js";
import type { ChannelAdapter } from "../../src/channels/adapter.js";
import type { Logger } from "../../src/logging/logger.js";

describe("CompactionNotifier", () => {
  let mockGoalLifecycle: GoalLifecycle;
  let mockArcLifecycle: ArcLifecycle;
  let mockRegistry: ChannelRegistry;
  let mockAdapter: ChannelAdapter;
  let mockLogger: Logger;

  beforeEach(() => {
    mockGoalLifecycle = {
      getGoalContext: vi.fn(),
    } as unknown as GoalLifecycle;

    mockArcLifecycle = {
      getArcContext: vi.fn(),
    } as unknown as ArcLifecycle;

    mockAdapter = {
      id: "test-channel",
      capabilities: { maxTextLength: 4096 },
      sendText: vi.fn(),
    } as unknown as ChannelAdapter;

    mockRegistry = {
      get: vi.fn(),
    } as unknown as ChannelRegistry;

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
  });

  it("sends compaction notification message", async () => {
    vi.mocked(mockGoalLifecycle).getGoalContext.mockReturnValue(
      "[USER GOALS]\nActive:\n  - Learn TypeScript\n  - Build a project",
    );
    vi.mocked(mockArcLifecycle).getArcContext.mockReturnValue(
      "[ACTIVE NARRATIVE ARCS]\n- \"Learning TypeScript\" (2d old, 5 entries)",
    );
    vi.mocked(mockRegistry).get.mockReturnValue(mockAdapter);

    const notifier = new CompactionNotifier(
      mockGoalLifecycle,
      mockArcLifecycle,
      mockRegistry,
      mockLogger,
      true,
    );

    await notifier.notify("user123", "chat456", "test-channel");

    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      to: "chat456",
      text: "Context refreshed after compaction. Currently tracking: 2 active goals, 1 memory arcs.",
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      { senderId: "user123", chatId: "chat456", channelId: "test-channel", activeGoals: 2, activeArcs: 1 },
      "Compaction notification sent",
    );
  });

  it("skips notification when disabled", async () => {
    const notifier = new CompactionNotifier(
      mockGoalLifecycle,
      mockArcLifecycle,
      mockRegistry,
      mockLogger,
      false,
    );

    await notifier.notify("user123", "chat456", "test-channel");

    expect(mockAdapter.sendText).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      { senderId: "user123", chatId: "chat456", channelId: "test-channel" },
      "Compaction notifier disabled",
    );
  });

  it("handles fallback when no intelligence data", async () => {
    vi.mocked(mockGoalLifecycle).getGoalContext.mockReturnValue(null);
    vi.mocked(mockArcLifecycle).getArcContext.mockReturnValue(null);
    vi.mocked(mockRegistry).get.mockReturnValue(mockAdapter);

    const notifier = new CompactionNotifier(
      mockGoalLifecycle,
      mockArcLifecycle,
      mockRegistry,
      mockLogger,
      true,
    );

    await notifier.notify("user123", "chat456", "test-channel");

    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      to: "chat456",
      text: "Context refreshed after compaction. Currently tracking: 0 active goals, 0 memory arcs.",
    });
  });

  it("logs warning when no adapter found", async () => {
    vi.mocked(mockRegistry).get.mockReturnValue(undefined);

    const notifier = new CompactionNotifier(
      mockGoalLifecycle,
      mockArcLifecycle,
      mockRegistry,
      mockLogger,
      true,
    );

    await notifier.notify("user123", "chat456", "test-channel");

    expect(mockAdapter.sendText).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { channelId: "test-channel" },
      "No adapter for compaction notification",
    );
  });

  it("logs error when sendText fails", async () => {
    vi.mocked(mockGoalLifecycle).getGoalContext.mockReturnValue(null);
    vi.mocked(mockArcLifecycle).getArcContext.mockReturnValue(null);
    vi.mocked(mockRegistry).get.mockReturnValue(mockAdapter);
    vi.mocked(mockAdapter.sendText).mockRejectedValue(new Error("Send failed"));

    const notifier = new CompactionNotifier(
      mockGoalLifecycle,
      mockArcLifecycle,
      mockRegistry,
      mockLogger,
      true,
    );

    await notifier.notify("user123", "chat456", "test-channel");

    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: expect.any(Error), senderId: "user123", chatId: "chat456", channelId: "test-channel" },
      "Failed to send compaction notification",
    );
  });
});
