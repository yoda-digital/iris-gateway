import { describe, it, expect, vi } from "vitest";
import { normalizeSlackMessage } from "../../src/channels/slack/normalize.js";

describe("normalizeSlackMessage", () => {
  it("normalizes a DM message", async () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Hello",
      ts: "1700000000.000000",
      channel: "D456",
      channel_type: "im",
    };
    const result = await normalizeSlackMessage(event);
    expect(result).toEqual({
      id: "1700000000.000000",
      channelId: "slack",
      senderId: "U123",
      senderName: "U123",
      chatId: "D456",
      chatType: "dm",
      text: "Hello",
      replyToId: undefined,
      timestamp: 1700000000000,
      raw: event,
    });
  });

  it("normalizes a group message", async () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Hi team",
      ts: "1700000000.000000",
      channel: "C789",
      channel_type: "channel",
    };
    const result = await normalizeSlackMessage(event);
    expect(result?.chatType).toBe("group");
  });

  it("returns null for subtype messages", async () => {
    const event = {
      type: "message",
      subtype: "channel_join",
      user: "U123",
      ts: "1700000000.000000",
      channel: "C789",
    };
    await expect(normalizeSlackMessage(event)).resolves.toBeNull();
  });

  it("returns null for bot messages", async () => {
    const event = {
      type: "message",
      bot_id: "B123",
      user: "U123",
      ts: "1700000000.000000",
      channel: "C789",
    };
    await expect(normalizeSlackMessage(event)).resolves.toBeNull();
  });

  it("returns null when user is missing", async () => {
    const event = {
      type: "message",
      ts: "1700000000.000000",
      channel: "C789",
    };
    await expect(normalizeSlackMessage(event)).resolves.toBeNull();
  });

  it("extracts thread_ts as replyToId", async () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Threaded reply",
      ts: "1700000001.000000",
      thread_ts: "1700000000.000000",
      channel: "C789",
    };
    const result = await normalizeSlackMessage(event);
    expect(result?.replyToId).toBe("1700000000.000000");
  });

  it("sets text to undefined when not present", async () => {
    const event = {
      type: "message",
      user: "U123",
      ts: "1700000000.000000",
      channel: "C789",
    };
    const result = await normalizeSlackMessage(event);
    expect(result?.text).toBeUndefined();
  });

  it("resolves display name via client.users.info", async () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Hello",
      ts: "1700000000.000000",
      channel: "D456",
      channel_type: "im",
    };
    const client = {
      users: {
        info: vi.fn().mockResolvedValue({
          user: {
            profile: { display_name: "Alice" },
            real_name: "Alice Smith",
          },
        }),
      },
    } as any;

    const result = await normalizeSlackMessage(event, client);
    expect(result?.senderName).toBe("Alice");
    expect(client.users.info).toHaveBeenCalledWith({ user: "U123" });
  });

  it("falls back to real_name when display_name is empty", async () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Hello",
      ts: "1700000000.000000",
      channel: "D456",
      channel_type: "im",
    };
    const client = {
      users: {
        info: vi.fn().mockResolvedValue({
          user: {
            profile: { display_name: "" },
            real_name: "Alice Smith",
          },
        }),
      },
    } as any;

    const result = await normalizeSlackMessage(event, client);
    expect(result?.senderName).toBe("Alice Smith");
  });

  it("falls back to user ID when client.users.info throws", async () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Hello",
      ts: "1700000000.000000",
      channel: "D456",
      channel_type: "im",
    };
    const client = {
      users: {
        info: vi.fn().mockRejectedValue(new Error("user_not_found")),
      },
    } as any;

    const result = await normalizeSlackMessage(event, client);
    expect(result?.senderName).toBe("U123");
  });

  it("uses cached display name on second call", async () => {
    const event = {
      type: "message",
      user: "U123",
      text: "Hello",
      ts: "1700000000.000000",
      channel: "D456",
      channel_type: "im",
    };
    const client = {
      users: {
        info: vi.fn().mockResolvedValue({
          user: {
            profile: { display_name: "Alice" },
            real_name: "Alice Smith",
          },
        }),
      },
    } as any;
    const cache = new Map<string, string>();

    await normalizeSlackMessage(event, client, cache);
    const result = await normalizeSlackMessage(event, client, cache);

    expect(result?.senderName).toBe("Alice");
    expect(client.users.info).toHaveBeenCalledTimes(1);
  });
});
