import { describe, it, expect, vi } from "vitest";
import { InputFile } from "grammy";
import {
  sendText,
  sendMedia,
  editMessage,
  deleteMessage,
  sendTyping,
  sendReaction,
} from "../../src/channels/telegram/send.js";

function mockBot() {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
      sendPhoto: vi.fn().mockResolvedValue({ message_id: 43 }),
      sendVideo: vi.fn().mockResolvedValue({ message_id: 44 }),
      sendAudio: vi.fn().mockResolvedValue({ message_id: 45 }),
      sendDocument: vi.fn().mockResolvedValue({ message_id: 46 }),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      setMessageReaction: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

describe("sendText", () => {
  it("calls sendMessage with correct args and returns messageId as string", async () => {
    const bot = mockBot();
    const result = await sendText(bot, "123", "Hello world");
    expect(bot.api.sendMessage).toHaveBeenCalledWith("123", "Hello world", {
      reply_parameters: undefined,
    });
    expect(result).toEqual({ messageId: "42" });
  });

  it("passes reply_parameters when replyToId is provided", async () => {
    const bot = mockBot();
    await sendText(bot, "123", "Reply text", "99");
    expect(bot.api.sendMessage).toHaveBeenCalledWith("123", "Reply text", {
      reply_parameters: { message_id: 99 },
    });
  });
});

describe("sendMedia", () => {
  it("calls sendPhoto for image type", async () => {
    const bot = mockBot();
    const result = await sendMedia(bot, {
      to: "10",
      type: "image",
      source: "/path/to/img.png",
      mimeType: "image/png",
      caption: "A photo",
    });
    expect(bot.api.sendPhoto).toHaveBeenCalledWith(
      "10",
      expect.any(InputFile),
      { caption: "A photo" },
    );
    expect(result).toEqual({ messageId: "43" });
  });

  it("calls sendVideo for video type", async () => {
    const bot = mockBot();
    const result = await sendMedia(bot, {
      to: "10",
      type: "video",
      source: "/path/to/vid.mp4",
      mimeType: "video/mp4",
      caption: "A video",
    });
    expect(bot.api.sendVideo).toHaveBeenCalledWith(
      "10",
      expect.any(InputFile),
      { caption: "A video" },
    );
    expect(result).toEqual({ messageId: "44" });
  });

  it("calls sendAudio for audio type", async () => {
    const bot = mockBot();
    const result = await sendMedia(bot, {
      to: "10",
      type: "audio",
      source: "/path/to/audio.mp3",
      mimeType: "audio/mpeg",
      caption: "A track",
    });
    expect(bot.api.sendAudio).toHaveBeenCalledWith(
      "10",
      expect.any(InputFile),
      { caption: "A track" },
    );
    expect(result).toEqual({ messageId: "45" });
  });

  it("calls sendDocument for document type (default case)", async () => {
    const bot = mockBot();
    const result = await sendMedia(bot, {
      to: "10",
      type: "document",
      source: "/path/to/file.pdf",
      mimeType: "application/pdf",
      caption: "A doc",
    });
    expect(bot.api.sendDocument).toHaveBeenCalledWith(
      "10",
      expect.any(InputFile),
      { caption: "A doc" },
    );
    expect(result).toEqual({ messageId: "46" });
  });

  it("creates InputFile from Buffer source", async () => {
    const bot = mockBot();
    const buf = Buffer.from("fake image data");
    await sendMedia(bot, {
      to: "10",
      type: "image",
      source: buf,
      mimeType: "image/png",
    });
    expect(bot.api.sendPhoto).toHaveBeenCalledWith(
      "10",
      expect.any(InputFile),
      { caption: undefined },
    );
  });
});

describe("editMessage", () => {
  it("calls editMessageText with Number(messageId)", async () => {
    const bot = mockBot();
    await editMessage(bot, "456", "78", "Updated text");
    expect(bot.api.editMessageText).toHaveBeenCalledWith(
      "456",
      78,
      "Updated text",
    );
  });
});

describe("deleteMessage", () => {
  it("calls deleteMessage with Number(messageId)", async () => {
    const bot = mockBot();
    await deleteMessage(bot, "456", "78");
    expect(bot.api.deleteMessage).toHaveBeenCalledWith("456", 78);
  });
});

describe("sendTyping", () => {
  it('calls sendChatAction with "typing"', async () => {
    const bot = mockBot();
    await sendTyping(bot, "999");
    expect(bot.api.sendChatAction).toHaveBeenCalledWith("999", "typing");
  });
});

describe("sendReaction", () => {
  it("calls setMessageReaction with emoji reaction array", async () => {
    const bot = mockBot();
    await sendReaction(bot, "456", "78", "👍");
    expect(bot.api.setMessageReaction).toHaveBeenCalledWith("456", 78, [
      { type: "emoji", emoji: "👍" },
    ]);
  });
});
