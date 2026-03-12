import type { Context } from "grammy";
import type { InboundMessage } from "../adapter.js";

export function normalizeTelegramMessage(ctx: Context): InboundMessage | null {
  const msg = ctx.message ?? ctx.editedMessage;
  if (!msg) return null;

  const chat = msg.chat;
  const from = msg.from;
  if (!from) return null;

  const chatType: "dm" | "group" =
    chat.type === "private" ? "dm" : "group";

  return {
    id: String(msg.message_id),
    channelId: "telegram",
    senderId: String(from.id),
    senderName:
      from.first_name + (from.last_name ? ` ${from.last_name}` : ""),
    chatId: String(chat.id),
    chatType,
    text: msg.text ?? msg.caption,
    replyToId: msg.reply_to_message
      ? String(msg.reply_to_message.message_id)
      : undefined,
    timestamp: msg.date * 1000,
    raw: msg,
  };
}
