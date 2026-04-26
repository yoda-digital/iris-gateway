import type { InboundMessage } from "../adapter.js";
import type { WebClient } from "@slack/web-api";

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

export async function normalizeSlackMessage(
  event: SlackMessageEvent,
  client?: WebClient,
  displayNameCache?: Map<string, string>,
): Promise<InboundMessage | null> {
  if (event.subtype) return null;
  if (event.bot_id) return null;
  // Require a user ID — messages without one are system messages
  if (!event.user) return null;

  const chatType: "dm" | "group" =
    event.channel_type === "im" ? "dm" : "group";

  let senderName = event.user;

  if (client) {
    const cached = displayNameCache?.get(event.user);
    if (cached) {
      senderName = cached;
    } else {
      try {
        const info = await client.users.info({ user: event.user });
        const resolved =
          info.user?.profile?.display_name ||
          info.user?.real_name ||
          event.user;
        senderName = resolved;
        displayNameCache?.set(event.user, resolved);
      } catch {
        // Fall back to raw user ID
      }
    }
  }

  return {
    id: event.ts,
    channelId: "slack",
    senderId: event.user,
    senderName,
    chatId: event.channel,
    chatType,
    text: event.text ?? undefined,
    replyToId: event.thread_ts ?? undefined,
    timestamp: parseFloat(event.ts) * 1000,
    raw: event,
  };
}
