import type { Message } from "discord.js";
import type { InboundMessage } from "../adapter.js";

export function normalizeDiscordMessage(msg: Message): InboundMessage | null {
  if (msg.author.bot) return null;

  const chatType: "dm" | "group" = msg.channel.isDMBased()
    ? "dm"
    : "group";

  return {
    id: msg.id,
    channelId: "discord",
    senderId: msg.author.id,
    senderName:
      msg.member?.displayName ?? msg.author.displayName ?? msg.author.username,
    chatId: msg.channel.id,
    chatType,
    text: msg.content || undefined,
    replyToId: msg.reference?.messageId ?? undefined,
    timestamp: msg.createdTimestamp,
    raw: msg,
  };
}
