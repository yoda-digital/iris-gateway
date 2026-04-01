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

/**
 * Cache for Slack user display names to avoid repeated API calls.
 * Maps user IDs to display names.
 */
export type UserDisplayNameCache = Map<string, string>;

/**
 * Slack client interface for the users.info API call.
 * This is a minimal interface to avoid importing the full Bolt types.
 */
export interface SlackClient {
  users: {
    info: (params: { user: string }) => Promise<{
      user?: {
        profile?: {
          display_name?: string;
          real_name?: string;
          name?: string;
        };
      };
    }>;
  };
}

/**
 * Resolve a Slack user ID to a human-readable display name.
 * Uses the users.info API to fetch the user's profile.
 *
 * @param userId - The Slack user ID (e.g., "U01234ABC")
 * @param client - Optional Slack client to use for the API call
 * @param cache - Optional cache to store resolved names
 * @returns The display name, or the user ID if resolution fails
 */
async function resolveDisplayName(
  userId: string,
  client?: SlackClient,
  cache?: UserDisplayNameCache,
): Promise<string> {
  // Check cache first
  if (cache?.has(userId)) {
    return cache.get(userId)!;
  }

  // If no client provided, return the user ID
  if (!client) {
    return userId;
  }

  try {
    const response = await client.users.info({ user: userId });
    const profile = response.user?.profile;

    // Prefer display_name, then real_name, then name
    const displayName =
      profile?.display_name ||
      profile?.real_name ||
      profile?.name ||
      userId;

    // Cache the result
    if (cache) {
      cache.set(userId, displayName);
    }

    return displayName;
  } catch {
    // If API call fails, return the user ID
    return userId;
  }
}

/**
 * Normalize a Slack message event into an InboundMessage.
 *
 * @param event - The Slack message event
 * @param client - Optional Slack client for resolving display names
 * @param cache - Optional cache for user display names
 * @returns The normalized InboundMessage, or null if the event should be skipped
 */
export async function normalizeSlackMessage(
  event: SlackMessageEvent,
  client?: SlackClient,
  cache?: UserDisplayNameCache,
): Promise<InboundMessage | null> {
  if (event.subtype) return null;
  if (event.bot_id) return null;
  // Require a user ID — messages without one are system messages
  if (!event.user) return null;

  const chatType: "dm" | "group" =
    event.channel_type === "im" ? "dm" : "group";

  // Resolve the display name from the Slack API
  const senderName = await resolveDisplayName(event.user, client, cache);

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