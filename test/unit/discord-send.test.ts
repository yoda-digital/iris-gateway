import { describe, it, expect, vi } from "vitest";
import {
  sendText,
  sendMedia,
  editMessage,
  deleteMessage,
  sendTyping,
  sendReaction,
} from "../../src/channels/discord/send.js";

function mockClient(options?: { noSend?: boolean; noMessages?: boolean }) {
  const msgMock = {
    id: "msg-1",
    edit: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
  };

  const channelMock: Record<string, unknown> = {
    send: vi.fn().mockResolvedValue(msgMock),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    messages: { fetch: vi.fn().mockResolvedValue(msgMock) },
  };

  if (options?.noSend) delete channelMock["send"];
  if (options?.noMessages) delete channelMock["messages"];

  return {
    client: {
      channels: {
        fetch: vi.fn().mockResolvedValue(channelMock),
      },
    } as any,
    channelMock,
    msgMock,
  };
}

describe("Discord: sendText", () => {
  it("sends text and returns messageId", async () => {
    const { client, channelMock } = mockClient();
    const result = await sendText(client, "ch-1", "Hello");
    expect(channelMock.send).toHaveBeenCalledWith({
      content: "Hello",
      reply: undefined,
    });
    expect(result).toEqual({ messageId: "msg-1" });
  });

  it("sends reply when replyToId provided", async () => {
    const { client, channelMock } = mockClient();
    await sendText(client, "ch-1", "Reply", "ref-1");
    expect(channelMock.send).toHaveBeenCalledWith({
      content: "Reply",
      reply: { messageReference: "ref-1" },
    });
  });

  it("throws when channel has no send method", async () => {
    const { client } = mockClient({ noSend: true });
    await expect(sendText(client, "ch-1", "Hello")).rejects.toThrow(
      "Cannot send to channel",
    );
  });

  it("throws when channel is null", async () => {
    const client = {
      channels: { fetch: vi.fn().mockResolvedValue(null) },
    } as any;
    await expect(sendText(client, "ch-1", "Hello")).rejects.toThrow(
      "Cannot send to channel",
    );
  });
});

describe("Discord: sendMedia", () => {
  it("sends file with caption and returns messageId", async () => {
    const { client, channelMock } = mockClient();
    const result = await sendMedia(client, {
      to: "ch-1",
      type: "image",
      source: Buffer.from("img-data"),
      mimeType: "image/png",
      caption: "A photo",
      filename: "photo.png",
    });
    expect(channelMock.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "A photo",
        files: expect.any(Array),
      }),
    );
    expect(result).toEqual({ messageId: "msg-1" });
  });

  it("uses default filename when not provided", async () => {
    const { client, channelMock } = mockClient();
    await sendMedia(client, {
      to: "ch-1",
      type: "document",
      source: Buffer.from("data"),
      mimeType: "application/octet-stream",
    });
    expect(channelMock.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: undefined,
        files: expect.any(Array),
      }),
    );
  });

  it("throws when channel has no send method", async () => {
    const { client } = mockClient({ noSend: true });
    await expect(
      sendMedia(client, {
        to: "ch-1",
        type: "image",
        source: Buffer.from("data"),
        mimeType: "image/png",
      }),
    ).rejects.toThrow("Cannot send to channel");
  });
});

describe("Discord: editMessage", () => {
  it("fetches message and calls edit", async () => {
    const { client, msgMock } = mockClient();
    await editMessage(client, "ch-1", "msg-1", "Updated");
    expect(msgMock.edit).toHaveBeenCalledWith("Updated");
  });

  it("does nothing when channel has no messages", async () => {
    const { client } = mockClient({ noMessages: true });
    // Should not throw
    await editMessage(client, "ch-1", "msg-1", "Updated");
  });
});

describe("Discord: deleteMessage", () => {
  it("fetches message and calls delete", async () => {
    const { client, msgMock } = mockClient();
    await deleteMessage(client, "ch-1", "msg-1");
    expect(msgMock.delete).toHaveBeenCalled();
  });
});

describe("Discord: sendTyping", () => {
  it("calls sendTyping on channel", async () => {
    const { client, channelMock } = mockClient();
    await sendTyping(client, "ch-1");
    expect(channelMock.sendTyping).toHaveBeenCalled();
  });
});

describe("Discord: sendReaction", () => {
  it("fetches message and reacts with emoji", async () => {
    const { client, msgMock } = mockClient();
    await sendReaction(client, "ch-1", "msg-1", "👍");
    expect(msgMock.react).toHaveBeenCalledWith("👍");
  });
});
