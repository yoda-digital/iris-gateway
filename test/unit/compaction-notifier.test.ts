import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { CompactionNotifier } from "../../src/bridge/compaction-notifier.js";
import type { SessionMap } from "../../src/bridge/session-map.js";
import type { ChannelRegistry } from "../../src/channels/registry.js";
import type { IntelligenceStore } from "../../src/intelligence/store.js";

function makeMockSessionMap(entry: any = null): SessionMap {
  return {
    findBySessionId: vi.fn().mockResolvedValue(entry),
  } as any;
}

function makeMockRegistry(adapter: any = null): ChannelRegistry {
  return {
    get: vi.fn().mockReturnValue(adapter),
  } as any;
}

function makeMockAdapter() {
  return {
    sendText: vi.fn().mockResolvedValue({ messageId: "m1" }),
  };
}

function makeMockStore(overrides: Partial<{
  activeGoals: any[];
  pausedGoals: any[];
  activeArcs: any[];
}> = {}): IntelligenceStore {
  return {
    getActiveGoals: vi.fn().mockReturnValue(overrides.activeGoals ?? []),
    getPausedGoals: vi.fn().mockReturnValue(overrides.pausedGoals ?? []),
    getActiveArcs: vi.fn().mockReturnValue(overrides.activeArcs ?? []),
  } as any;
}

const logger = pino({ level: "silent" });

describe("CompactionNotifier", () => {
  describe("buildMessage", () => {
    it("returns fallback when no intelligence store", () => {
      const notifier = new CompactionNotifier(makeMockSessionMap(), makeMockRegistry(), logger, null);
      expect(notifier.buildMessage("user1")).toBe("Context refreshed.");
    });

    it("returns fallback when no goals or arcs", () => {
      const notifier = new CompactionNotifier(makeMockSessionMap(), makeMockRegistry(), logger, makeMockStore());
      expect(notifier.buildMessage("user1")).toBe("Context refreshed.");
    });

    it("includes combined goal count", () => {
      const store = makeMockStore({
        activeGoals: [{ id: "g1" }, { id: "g2" }],
        pausedGoals: [{ id: "g3" }],
      });
      const notifier = new CompactionNotifier(makeMockSessionMap(), makeMockRegistry(), logger, store);
      expect(notifier.buildMessage("user1")).toBe(
        "Context refreshed after compaction. Currently tracking: 3 goals.",
      );
    });

    it("includes active arc count", () => {
      const store = makeMockStore({ activeArcs: [{ id: "a1" }] });
      const notifier = new CompactionNotifier(makeMockSessionMap(), makeMockRegistry(), logger, store);
      expect(notifier.buildMessage("user1")).toBe(
        "Context refreshed after compaction. Currently tracking: 1 memory arc.",
      );
    });

    it("includes both goals and arcs", () => {
      const store = makeMockStore({
        activeGoals: [{ id: "g1" }],
        activeArcs: [{ id: "a1" }, { id: "a2" }],
      });
      const notifier = new CompactionNotifier(makeMockSessionMap(), makeMockRegistry(), logger, store);
      expect(notifier.buildMessage("user1")).toBe(
        "Context refreshed after compaction. Currently tracking: 1 goal, 2 memory arcs.",
      );
    });
  });

  describe("notify", () => {
    it("sends message when session and adapter exist", async () => {
      const adapter = makeMockAdapter();
      const entry = { senderId: "user1", channelId: "telegram", chatId: "chat1" };
      const notifier = new CompactionNotifier(
        makeMockSessionMap(entry),
        makeMockRegistry(adapter),
        logger,
        makeMockStore({ activeGoals: [{ id: "g1" }] }),
      );

      await notifier.notify("session1");

      expect(adapter.sendText).toHaveBeenCalledWith({
        to: "chat1",
        text: "Context refreshed after compaction. Currently tracking: 1 goal.",
      });
    });

    it("skips when no session entry is found", async () => {
      const adapter = makeMockAdapter();
      const notifier = new CompactionNotifier(
        makeMockSessionMap(null),
        makeMockRegistry(adapter),
        logger,
        makeMockStore(),
      );

      await notifier.notify("session1");

      expect(adapter.sendText).not.toHaveBeenCalled();
    });

    it("skips when no adapter is found", async () => {
      const entry = { senderId: "user1", channelId: "telegram", chatId: "chat1" };
      const notifier = new CompactionNotifier(
        makeMockSessionMap(entry),
        makeMockRegistry(null),
        logger,
        makeMockStore(),
      );

      await expect(notifier.notify("session1")).resolves.toBeUndefined();
    });

    it("handles sendText failure gracefully", async () => {
      const adapter = { sendText: vi.fn().mockRejectedValue(new Error("network")) };
      const entry = { senderId: "user1", channelId: "telegram", chatId: "chat1" };
      const notifier = new CompactionNotifier(
        makeMockSessionMap(entry),
        makeMockRegistry(adapter),
        logger,
        makeMockStore(),
      );

      await expect(notifier.notify("session1")).resolves.toBeUndefined();
    });
  });
});
