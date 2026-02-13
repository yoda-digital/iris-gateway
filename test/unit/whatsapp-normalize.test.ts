import { describe, it, expect } from "vitest";
import { normalizeWhatsAppMessage } from "../../src/channels/whatsapp/normalize.js";

function mockWAMessage(overrides: Record<string, unknown> = {}) {
  return {
    key: {
      id: "wa-1",
      fromMe: false,
      remoteJid: "123@s.whatsapp.net",
      participant: undefined,
    },
    message: {
      conversation: "Hello",
    },
    messageTimestamp: 1700000,
    pushName: "Alice",
    ...overrides,
  } as any;
}

describe("normalizeWhatsAppMessage", () => {
  it("normalizes a DM message", () => {
    const msg = mockWAMessage();
    const result = normalizeWhatsAppMessage(msg);
    expect(result).toEqual({
      id: "wa-1",
      channelId: "whatsapp",
      senderId: "123@s.whatsapp.net",
      senderName: "Alice",
      chatId: "123@s.whatsapp.net",
      chatType: "dm",
      text: "Hello",
      replyToId: undefined,
      timestamp: 1700000000,
      raw: msg,
    });
  });

  it("normalizes a group message", () => {
    const msg = mockWAMessage({
      key: {
        id: "wa-2",
        fromMe: false,
        remoteJid: "group@g.us",
        participant: "456@s.whatsapp.net",
      },
    });
    const result = normalizeWhatsAppMessage(msg);
    expect(result?.chatType).toBe("group");
    expect(result?.senderId).toBe("456@s.whatsapp.net");
    expect(result?.chatId).toBe("group@g.us");
  });

  it("returns null for fromMe messages", () => {
    const msg = mockWAMessage({
      key: { id: "wa-3", fromMe: true, remoteJid: "123@s.whatsapp.net" },
    });
    expect(normalizeWhatsAppMessage(msg)).toBeNull();
  });

  it("returns null when message content is missing", () => {
    const msg = mockWAMessage({ message: null });
    expect(normalizeWhatsAppMessage(msg)).toBeNull();
  });

  it("returns null when key is missing", () => {
    const msg = mockWAMessage({ key: null });
    expect(normalizeWhatsAppMessage(msg)).toBeNull();
  });

  it("extracts text from extendedTextMessage", () => {
    const msg = mockWAMessage({
      message: { extendedTextMessage: { text: "Extended text" } },
    });
    const result = normalizeWhatsAppMessage(msg);
    expect(result?.text).toBe("Extended text");
  });

  it("extracts caption from imageMessage", () => {
    const msg = mockWAMessage({
      message: { imageMessage: { caption: "Photo caption" } },
    });
    const result = normalizeWhatsAppMessage(msg);
    expect(result?.text).toBe("Photo caption");
  });

  it("extracts caption from videoMessage", () => {
    const msg = mockWAMessage({
      message: { videoMessage: { caption: "Video caption" } },
    });
    const result = normalizeWhatsAppMessage(msg);
    expect(result?.text).toBe("Video caption");
  });

  it("extracts replyToId from contextInfo", () => {
    const msg = mockWAMessage({
      message: {
        extendedTextMessage: {
          text: "Replying",
          contextInfo: { stanzaId: "original-msg" },
        },
      },
    });
    const result = normalizeWhatsAppMessage(msg);
    expect(result?.replyToId).toBe("original-msg");
  });

  it("uses senderId as senderName when pushName is missing", () => {
    const msg = mockWAMessage({ pushName: undefined });
    const result = normalizeWhatsAppMessage(msg);
    expect(result?.senderName).toBe("123@s.whatsapp.net");
  });
});
