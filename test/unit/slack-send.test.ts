import { describe, it, expect, vi } from "vitest";
import {
  sendText,
  sendMedia,
  editMessage,
  deleteMessage,
  sendTyping,
  sendReaction,
} from "../../src/channels/slack/send.js";

function mockApp() {
  return {
    client: {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: "1234567890.123456" }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      filesUploadV2: vi.fn().mockResolvedValue({
        files: [{ id: "file-1" }],
      }),
      reactions: {
        add: vi.fn().mockResolvedValue({}),
      },
    },
  } as any;
}

describe("Slack: sendText", () => {
  it("sends text and returns ts as messageId", async () => {
    const app = mockApp();
    const result = await sendText(app, "C123", "Hello");
    expect(app.client.chat.postMessage).toHaveBeenCalledWith({
      channel: "C123",
      text: "Hello",
      thread_ts: undefined,
    });
    expect(result).toEqual({ messageId: "1234567890.123456" });
  });

  it("sends threaded reply when replyToId provided", async () => {
    const app = mockApp();
    await sendText(app, "C123", "Reply", "1234567890.000000");
    expect(app.client.chat.postMessage).toHaveBeenCalledWith({
      channel: "C123",
      text: "Reply",
      thread_ts: "1234567890.000000",
    });
  });

  it("returns empty messageId when ts is undefined", async () => {
    const app = mockApp();
    app.client.chat.postMessage.mockResolvedValue({});
    const result = await sendText(app, "C123", "Hello");
    expect(result).toEqual({ messageId: "" });
  });
});

describe("Slack: sendMedia", () => {
  it("uploads file with caption and returns file id", async () => {
    const app = mockApp();
    const buf = Buffer.from("img-data");
    const result = await sendMedia(app, {
      to: "C123",
      type: "image",
      source: buf,
      mimeType: "image/png",
      caption: "Photo",
      filename: "photo.png",
    });
    expect(app.client.filesUploadV2).toHaveBeenCalledWith({
      channel_id: "C123",
      file: buf,
      filename: "photo.png",
      initial_comment: "Photo",
    });
    expect(result).toEqual({ messageId: "file-1" });
  });

  it("uses default filename when not provided", async () => {
    const app = mockApp();
    await sendMedia(app, {
      to: "C123",
      type: "document",
      source: Buffer.from("data"),
      mimeType: "application/octet-stream",
    });
    expect(app.client.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "file" }),
    );
  });

  it("returns empty messageId when files array is empty", async () => {
    const app = mockApp();
    app.client.filesUploadV2.mockResolvedValue({ files: [] });
    const result = await sendMedia(app, {
      to: "C123",
      type: "image",
      source: Buffer.from("data"),
      mimeType: "image/png",
    });
    expect(result).toEqual({ messageId: "" });
  });
});

describe("Slack: editMessage", () => {
  it("calls chat.update with correct args", async () => {
    const app = mockApp();
    await editMessage(app, "C123", "ts-1", "Updated");
    expect(app.client.chat.update).toHaveBeenCalledWith({
      channel: "C123",
      ts: "ts-1",
      text: "Updated",
    });
  });
});

describe("Slack: deleteMessage", () => {
  it("calls chat.delete with correct args", async () => {
    const app = mockApp();
    await deleteMessage(app, "C123", "ts-1");
    expect(app.client.chat.delete).toHaveBeenCalledWith({
      channel: "C123",
      ts: "ts-1",
    });
  });
});

describe("Slack: sendTyping", () => {
  it("does nothing (no-op)", async () => {
    const app = mockApp();
    // Should not throw
    await sendTyping(app, "C123");
  });
});

describe("Slack: sendReaction", () => {
  it("calls reactions.add with stripped emoji colons", async () => {
    const app = mockApp();
    await sendReaction(app, "C123", "ts-1", ":thumbsup:");
    expect(app.client.reactions.add).toHaveBeenCalledWith({
      channel: "C123",
      timestamp: "ts-1",
      name: "thumbsup",
    });
  });

  it("works with emoji without colons", async () => {
    const app = mockApp();
    await sendReaction(app, "C123", "ts-1", "wave");
    expect(app.client.reactions.add).toHaveBeenCalledWith({
      channel: "C123",
      timestamp: "ts-1",
      name: "wave",
    });
  });
});
