import { describe, it, expect, vi } from "vitest";
import {
  sendText,
  sendMedia,
  editMessage,
  deleteMessage,
  sendTyping,
} from "../../src/channels/whatsapp/send.js";

function mockSocket() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ key: { id: "wa-msg-1" } }),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("WhatsApp: sendText", () => {
  it("sends text and returns messageId", async () => {
    const socket = mockSocket();
    const result = await sendText(socket, "123@s.whatsapp.net", "Hello");
    expect(socket.sendMessage).toHaveBeenCalledWith("123@s.whatsapp.net", {
      text: "Hello",
    });
    expect(result).toEqual({ messageId: "wa-msg-1" });
  });

  it("returns empty messageId when result has no key", async () => {
    const socket = mockSocket();
    socket.sendMessage.mockResolvedValue(null);
    const result = await sendText(socket, "123@s.whatsapp.net", "Hello");
    expect(result).toEqual({ messageId: "" });
  });
});

describe("WhatsApp: sendMedia", () => {
  it("sends image with caption", async () => {
    const socket = mockSocket();
    const buf = Buffer.from("img-data");
    const result = await sendMedia(socket, {
      to: "123@s.whatsapp.net",
      type: "image",
      source: buf,
      mimeType: "image/png",
      caption: "Photo",
    });
    expect(socket.sendMessage).toHaveBeenCalledWith("123@s.whatsapp.net", {
      image: buf,
      caption: "Photo",
      mimetype: "image/png",
    });
    expect(result).toEqual({ messageId: "wa-msg-1" });
  });

  it("sends video with caption", async () => {
    const socket = mockSocket();
    const buf = Buffer.from("vid-data");
    await sendMedia(socket, {
      to: "jid",
      type: "video",
      source: buf,
      mimeType: "video/mp4",
      caption: "Video",
    });
    expect(socket.sendMessage).toHaveBeenCalledWith("jid", {
      video: buf,
      caption: "Video",
      mimetype: "video/mp4",
    });
  });

  it("sends audio without caption", async () => {
    const socket = mockSocket();
    const buf = Buffer.from("audio-data");
    await sendMedia(socket, {
      to: "jid",
      type: "audio",
      source: buf,
      mimeType: "audio/mpeg",
    });
    expect(socket.sendMessage).toHaveBeenCalledWith("jid", {
      audio: buf,
      mimetype: "audio/mpeg",
    });
  });

  it("sends document with filename", async () => {
    const socket = mockSocket();
    const buf = Buffer.from("doc-data");
    await sendMedia(socket, {
      to: "jid",
      type: "document",
      source: buf,
      mimeType: "application/pdf",
      filename: "report.pdf",
      caption: "Report",
    });
    expect(socket.sendMessage).toHaveBeenCalledWith("jid", {
      document: buf,
      mimetype: "application/pdf",
      fileName: "report.pdf",
      caption: "Report",
    });
  });

  it("uses default filename for document when not provided", async () => {
    const socket = mockSocket();
    await sendMedia(socket, {
      to: "jid",
      type: "document",
      source: Buffer.from("data"),
      mimeType: "application/octet-stream",
    });
    expect(socket.sendMessage).toHaveBeenCalledWith(
      "jid",
      expect.objectContaining({ fileName: "file" }),
    );
  });
});

describe("WhatsApp: editMessage", () => {
  it("sends edit message with correct format", async () => {
    const socket = mockSocket();
    await editMessage(socket, "jid", "msg-1", "Updated");
    expect(socket.sendMessage).toHaveBeenCalledWith("jid", {
      text: "Updated",
      edit: { remoteJid: "jid", id: "msg-1", fromMe: true },
    });
  });
});

describe("WhatsApp: deleteMessage", () => {
  it("sends delete message with correct format", async () => {
    const socket = mockSocket();
    await deleteMessage(socket, "jid", "msg-1");
    expect(socket.sendMessage).toHaveBeenCalledWith("jid", {
      delete: { remoteJid: "jid", id: "msg-1", fromMe: true },
    });
  });
});

describe("WhatsApp: sendTyping", () => {
  it("sends composing presence update", async () => {
    const socket = mockSocket();
    await sendTyping(socket, "jid");
    expect(socket.sendPresenceUpdate).toHaveBeenCalledWith("composing", "jid");
  });
});
