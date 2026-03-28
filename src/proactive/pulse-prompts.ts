/**
 * pulse-prompts.ts — Prompt builders for the PulseEngine.
 * Extracted from engine.ts (VISION.md §1 — 500-line hard limit pre-emption, issue #235).
 *
 * @decomposition-plan
 * engine.ts split at 341 lines:
 *   - pulse-prompts.ts → buildIntentPrompt, buildTriggerPrompt, isQuietHours (this file)
 *   - engine.ts        → PulseEngine class — scheduling + execution loop (~220 lines)
 */
import type { ProactiveConfig, ProactiveIntent, ProactiveTrigger } from "./types.js";
import type { VaultStore } from "../vault/store.js";

export function buildIntentPrompt(
  intent: ProactiveIntent,
  vaultStore: VaultStore,
  config: ProactiveConfig,
  engagementRate: number,
  sentToday: number,
  limit: number,
): string {
  const elapsed = Date.now() - intent.createdAt;
  const hoursAgo = Math.floor(elapsed / 3_600_000);
  const timeAgo = hoursAgo >= 24
    ? `${Math.floor(hoursAgo / 24)} days ago`
    : `${hoursAgo} hours ago`;

  const profile = vaultStore.getProfile(intent.senderId, intent.channelId);
  const profileBlock = profile
    ? `User: ${profile.name ?? "unknown"} | ${profile.timezone ?? "no timezone"} | ${profile.language ?? ""}`
    : "User: unknown";

  return `[PROACTIVE FOLLOW-UP]
You registered an intent ${timeAgo}: "${intent.what}"
${intent.why ? `Reason: "${intent.why}"` : ""}

${profileBlock}
Your quota: ${limit - sentToday}/${limit} proactive messages remaining today
Your engagement rate: ${Math.round(engagementRate * 100)}% of proactive messages get replies

Decide: Should you follow up now? If yes, compose a natural, helpful message.
Use any tools you need (send_message, vault_remember, canvas_update, etc.).
If not worth it, respond with just: [SKIP]
If you want to try later, respond with: [DEFER Xh] (replace X with hours)`;
}

export function buildTriggerPrompt(
  trigger: ProactiveTrigger,
  vaultStore: VaultStore,
  config: ProactiveConfig,
  engagementRate: number,
  sentToday: number,
  limit: number,
): string {
  const profile = vaultStore.getProfile(trigger.senderId, trigger.channelId);
  const profileBlock = profile
    ? `User: ${profile.name ?? "unknown"} | ${profile.timezone ?? "no timezone"} | ${profile.language ?? ""}`
    : "User: unknown";

  return `[PROACTIVE OUTREACH — ${trigger.type.replace(/_/g, " ").toUpperCase()}]
${trigger.context}

${profileBlock}
Your quota: ${limit - sentToday}/${limit} proactive messages remaining today
Your engagement rate: ${Math.round(engagementRate * 100)}% of proactive messages get replies

Decide: Should you reach out? If yes, compose a natural, warm message.
If not appropriate, respond with just: [SKIP]
If you want to try later, respond with: [DEFER Xh]`;
}

export function isQuietHours(
  senderId: string,
  channelId: string,
  vaultStore: VaultStore,
  config: ProactiveConfig,
): boolean {
  const profile = vaultStore.getProfile(senderId, channelId);
  const tz = profile?.timezone;

  let hour: number;
  if (tz) {
    try {
      hour = parseInt(
        new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false }),
        10,
      );
    } catch {
      hour = new Date().getHours();
    }
  } else {
    hour = new Date().getHours();
  }

  const { start, end } = config.quietHours;
  if (start > end) {
    return hour >= start || hour < end;
  }
  return hour >= start && hour < end;
}
