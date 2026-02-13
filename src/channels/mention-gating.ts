import type { InboundMessage } from "./adapter.js";

/**
 * Determine whether a group message should be processed.
 * DM messages always pass through. Group messages require an @mention
 * of the bot (by ID or username), or a match against a custom pattern.
 */
export function shouldProcessGroupMessage(
  msg: InboundMessage,
  botId: string,
  mentionPattern?: string | RegExp,
): boolean {
  if (msg.chatType === "dm") {
    return true;
  }

  const text = msg.text ?? "";

  // Custom regex pattern takes priority when provided
  if (mentionPattern !== undefined) {
    const regex =
      mentionPattern instanceof RegExp
        ? mentionPattern
        : new RegExp(mentionPattern, "i");
    return regex.test(text);
  }

  // Default: check for @botId or @botUsername (case-insensitive)
  const escaped = escapeRegExp(botId);
  const defaultPattern = new RegExp(`@${escaped}\\b`, "i");
  return defaultPattern.test(text);
}

/**
 * Strip the bot @mention from message text so the downstream LLM
 * receives a clean prompt without the mention noise.
 */
export function stripBotMention(
  text: string,
  botId: string,
  mentionPattern?: string | RegExp,
): string {
  if (mentionPattern !== undefined) {
    const regex =
      mentionPattern instanceof RegExp
        ? mentionPattern
        : new RegExp(mentionPattern, "gi");
    return text.replace(regex, "").replace(/\s{2,}/g, " ").trim();
  }

  const escaped = escapeRegExp(botId);
  const defaultPattern = new RegExp(`@${escaped}\\b`, "gi");
  return text.replace(defaultPattern, "").replace(/\s{2,}/g, " ").trim();
}

/** Escape special regex characters in a literal string. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
