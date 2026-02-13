import type { InboundMessage } from "../adapter.js";

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  channel: string;
  channel_type?: string;
}

export function normalizeSlackMessage(
  event: SlackMessageEvent,
): InboundMessage | null {
  if (event.subtype) return null;
  if (event.bot_id) return null;
  // Require a user ID — messages without one are system messages
  if (!event.user) return null;

  const chatType: "dm" | "group" =
    event.channel_type === "im" ? "dm" : "group";

  return {
    id: event.ts,
    channelId: "slack",
    senderId: event.user,
    senderName: event.user, // Slack events only have user ID; display name requires users.info API
    chatId: event.channel,
    chatType,
    text: event.text ?? undefined,
    replyToId: event.thread_ts ?? undefined,
    timestamp: parseFloat(event.ts) * 1000,
    raw: event,
  };
}
