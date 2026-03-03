import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrossChannelResolver } from "../../src/intelligence/cross-channel/resolver.js";

describe("CrossChannelResolver - Channel Preference Detection", () => {
  let resolver: CrossChannelResolver;
  let mockRawDb: any;

  beforeEach(() => {
    mockRawDb = {
      prepare: vi.fn(),
    };

    const mockVaultDb = {
      raw: vi.fn().mockReturnValue(mockRawDb),
    } as any;

    const mockBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      dispose: vi.fn(),
    } as any;

    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    } as any;

    resolver = new CrossChannelResolver(mockVaultDb, mockBus, mockLogger);
  });

  it("detects preferred channel from activity patterns", () => {
    const profileStmt = {
      all: vi.fn().mockReturnValue([
        { channel_id: "telegram", last_seen: Date.now() - 1000 },
        { channel_id: "discord", last_seen: Date.now() - 100000 },
      ]),
    };

    const usageStmt = {
      all: vi.fn().mockReturnValue([
        { channel_id: "telegram", cnt: 45 },
        { channel_id: "discord", cnt: 12 },
      ]),
    };

    let callCount = 0;
    mockRawDb.prepare = vi.fn((query: string) => {
      callCount++;
      if (callCount === 1) return profileStmt;
      if (callCount === 2) return usageStmt;
      return { all: vi.fn().mockReturnValue([]) };
    });

    const context = resolver.resolve("user123");

    expect(context.preferredChannel).toBeDefined();
    expect(context.preferredChannel.channelId).toBe("telegram");
  });

  it("returns single channel with high confidence when only one active", () => {
    const profileStmt = {
      all: vi.fn().mockReturnValue([
        { channel_id: "telegram", last_seen: Date.now() },
      ]),
    };

    const usageStmt = {
      all: vi.fn().mockReturnValue([
        { channel_id: "telegram", cnt: 50 },
      ]),
    };

    let callCount = 0;
    mockRawDb.prepare = vi.fn((query: string) => {
      callCount++;
      if (callCount === 1) return profileStmt;
      if (callCount === 2) return usageStmt;
      return { all: vi.fn().mockReturnValue([]) };
    });

    const context = resolver.resolve("user123");

    expect(context.preferredChannel.channelId).toBe("telegram");
    expect(context.preferredChannel.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("returns unknown channel with low confidence when no activity", () => {
    const profileStmt = {
      all: vi.fn().mockReturnValue([]),
    };

    const usageStmt = {
      all: vi.fn().mockReturnValue([]),
    };

    let callCount = 0;
    mockRawDb.prepare = vi.fn((query: string) => {
      callCount++;
      if (callCount === 1) return profileStmt;
      if (callCount === 2) return usageStmt;
      return { all: vi.fn().mockReturnValue([]) };
    });

    const context = resolver.resolve("user123");

    expect(context.preferredChannel.channelId).toBe("unknown");
    expect(context.preferredChannel.confidence).toBe(0);
  });

  it("builds full cross-channel context with channels array", () => {
    const profileStmt = {
      all: vi.fn().mockReturnValue([
        { channel_id: "telegram", last_seen: Date.now() },
        { channel_id: "discord", last_seen: Date.now() - 1000 },
      ]),
    };

    const usageStmt = {
      all: vi.fn().mockReturnValue([
        { channel_id: "telegram", cnt: 50 },
        { channel_id: "discord", cnt: 20 },
      ]),
    };

    let callCount = 0;
    mockRawDb.prepare = vi.fn((query: string) => {
      callCount++;
      if (callCount === 1) return profileStmt;
      if (callCount === 2) return usageStmt;
      return { all: vi.fn().mockReturnValue([]) };
    });

    const context = resolver.resolve("user123");

    expect(context.channels).toBeDefined();
    expect(context.channels.length).toBe(2);
  });

  it("uses message count (70%) and recency (30%) in preference scoring", () => {
    const now = Date.now();
    const profileStmt = {
      all: vi.fn().mockReturnValue([
        { channel_id: "telegram", last_seen: now },
        { channel_id: "discord", last_seen: now - 604800000 }, // 7 days ago
      ]),
    };

    const usageStmt = {
      all: vi.fn().mockReturnValue([
        { channel_id: "telegram", cnt: 50 },
        { channel_id: "discord", cnt: 45 },
      ]),
    };

    let callCount = 0;
    mockRawDb.prepare = vi.fn((query: string) => {
      callCount++;
      if (callCount === 1) return profileStmt;
      if (callCount === 2) return usageStmt;
      return { all: vi.fn().mockReturnValue([]) };
    });

    const context = resolver.resolve("user123");

    // Telegram is preferred due to recency and higher message count
    expect(context.preferredChannel.channelId).toBe("telegram");
  });
});
