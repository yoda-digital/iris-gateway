import type { WAMessage } from "@whiskeysockets/baileys";
import type { InboundMessage } from "../adapter.js";

export function normalizeWhatsAppMessage(
  msg: WAMessage,
): InboundMessage | null {
  const key = msg.key;
  if (!key || key.fromMe) return null;

  const content = msg.message;
  if (!content) return null;

  const remoteJid = key.remoteJid ?? "";
  const isGroup = remoteJid.endsWith("@g.us");
  const senderId = isGroup
    ? key.participant ?? remoteJid
    : remoteJid;

  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption;

  const pushName = msg.pushName ?? senderId;

  return {
    id: key.id ?? "",
    channelId: "whatsapp",
    senderId,
    senderName: pushName,
    chatId: remoteJid,
    chatType: isGroup ? "group" : "dm",
    text: text ?? undefined,
    replyToId: content.extendedTextMessage?.contextInfo?.stanzaId ?? undefined,
    timestamp: Number(msg.messageTimestamp ?? 0) * 1000,
    raw: msg,
  };
}
