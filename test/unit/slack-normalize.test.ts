import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeSlackMessage,
  type SlackMessageEvent,
  type SlackClient,
  type UserDisplayNameCache,
} from "../../src/channels/slack/normalize.js";

describe("normalizeSlackMessage", () => {
  const baseEvent: SlackMessageEvent = {
    type: "message",
    user: "U01234ABC",
    text: "Hello world",
    ts: "1234567890.123456",
    channel: "C12345ABC",
    channel_type: "channel",
  };

  let mockClient: SlackClient;
  let cache: UserDisplayNameCache;

  beforeEach(() => {
    cache = new Map();
    mockClient = {
      users: {
        info: vi.fn().mockResolvedValue({
          user: {
            profile: {
              display_name: "Alice Smith",
              real_name: "Alice",
              name: "alice",
            },
          },
        }),
      },
    };
    vi.clearAllMocks();
  });

  describe("display name resolution", () => {
    it("resolves display name from users.info API", async () => {
      const result = await normalizeSlackMessage(baseEvent, mockClient, cache);

      expect(result).not.toBeNull();
      expect(result!.senderName).toBe("Alice Smith");
      expect(mockClient.users.info).toHaveBeenCalledWith({ user: "U01234ABC" });
    });

    it("falls back to real_name when display_name is empty", async () => {
      mockClient.users.info = vi.fn().mockResolvedValue({
        user: {
          profile: {
            display_name: "",
            real_name: "Bob Jones",
            name: "bob",
          },
        },
      });

      const result = await normalizeSlackMessage(baseEvent, mockClient, cache);

      expect(result!.senderName).toBe("Bob Jones");
    });

    it("falls back to name when both display_name and real_name are empty", async () => {
      mockClient.users.info = vi.fn().mockResolvedValue({
        user: {
          profile: {
            display_name: "",
            real_name: "",
            name: "charlie",
          },
        },
      });

      const result = await normalizeSlackMessage(baseEvent, mockClient, cache);

      expect(result!.senderName).toBe("charlie");
    });

    it("falls back to user ID when API call throws", async () => {
      mockClient.users.info = vi.fn().mockRejectedValue(new Error("API error"));

      const result = await normalizeSlackMessage(baseEvent, mockClient, cache);

      expect(result!.senderName).toBe("U01234ABC");
    });

    it("falls back to user ID when user profile is missing", async () => {
      mockClient.users.info = vi.fn().mockResolvedValue({
        user: {},
      });

      const result = await normalizeSlackMessage(baseEvent, mockClient, cache);

      expect(result!.senderName).toBe("U01234ABC");
    });

    it("falls back to user ID when client is not provided", async () => {
      const result = await normalizeSlackMessage(baseEvent, undefined, cache);

      expect(result!.senderName).toBe("U01234ABC");
      // No API call should be made
      expect(mockClient.users.info).not.toHaveBeenCalled();
    });
  });

  describe("cache behavior", () => {
    it("caches resolved display names", async () => {
      const result1 = await normalizeSlackMessage(baseEvent, mockClient, cache);
      const result2 = await normalizeSlackMessage(baseEvent, mockClient, cache);

      expect(result1!.senderName).toBe("Alice Smith");
      expect(result2!.senderName).toBe("Alice Smith");
      // API should only be called once due to caching
      expect(mockClient.users.info).toHaveBeenCalledTimes(1);
    });

    it("uses cached value without API call", async () => {
      // Pre-populate cache
      cache.set("U01234ABC", "Cached Name");

      const result = await normalizeSlackMessage(baseEvent, mockClient, cache);

      expect(result!.senderName).toBe("Cached Name");
      // No API call should be made
      expect(mockClient.users.info).not.toHaveBeenCalled();
    });

    it("different users are cached separately", async () => {
      const event1 = { ...baseEvent, user: "U01234ABC" };
      const event2 = { ...baseEvent, user: "U98765XYZ" };

      mockClient.users.info = vi.fn().mockImplementation(({ user }) => {
        if (user === "U01234ABC") {
          return Promise.resolve({
            user: { profile: { display_name: "Alice Smith" } },
          });
        }
        return Promise.resolve({
          user: { profile: { display_name: "Bob Jones" } },
        });
      });

      const result1 = await normalizeSlackMessage(event1, mockClient, cache);
      const result2 = await normalizeSlackMessage(event2, mockClient, cache);

      expect(result1!.senderName).toBe("Alice Smith");
      expect(result2!.senderName).toBe("Bob Jones");
      // Both users should be cached
      expect(cache.has("U01234ABC")).toBe(true);
      expect(cache.has("U98765XYZ")).toBe(true);
    });
  });

  describe("event filtering", () => {
    it("returns null for messages with subtype", async () => {
      const event = { ...baseEvent, subtype: "bot_message" };

      const result = await normalizeSlackMessage(event, mockClient, cache);

      expect(result).toBeNull();
    });

    it("returns null for messages with bot_id", async () => {
      const event = { ...baseEvent, bot_id: "B12345" };

      const result = await normalizeSlackMessage(event, mockClient, cache);

      expect(result).toBeNull();
    });

    it("returns null for messages without user", async () => {
      const event = { ...baseEvent, user: undefined };

      const result = await normalizeSlackMessage(event, mockClient, cache);

      expect(result).toBeNull();
    });
  });

  describe("message structure", () => {
    it("returns correct InboundMessage structure", async () => {
      const result = await normalizeSlackMessage(baseEvent, mockClient, cache);

      expect(result).toEqual({
        id: "1234567890.123456",
        channelId: "slack",
        senderId: "U01234ABC",
        senderName: "Alice Smith",
        chatId: "C12345ABC",
        chatType: "group",
        text: "Hello world",
        replyToId: undefined,
        timestamp: 1234567890123.456,
        raw: baseEvent,
      });
    });

    it("sets chatType to 'dm' for channel_type 'im'", async () => {
      const event = { ...baseEvent, channel_type: "im" };

      const result = await normalizeSlackMessage(event, mockClient, cache);

      expect(result!.chatType).toBe("dm");
    });

    it("sets replyToId when thread_ts is present", async () => {
      const event = { ...baseEvent, thread_ts: "1234567890.000001" };

      const result = await normalizeSlackMessage(event, mockClient, cache);

      expect(result!.replyToId).toBe("1234567890.000001");
    });
  });
});