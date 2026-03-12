import type { VaultDB } from "../../vault/db.js";
import type { Logger } from "../../logging/logger.js";
import type { IntelligenceBus } from "../bus.js";
import type { ChannelPresence, ChannelPreference, CrossChannelContext } from "../types.js";

/**
 * Cross-channel intelligence resolver.
 * Queries vault profiles and usage data to determine:
 *  - Which channels a user is active on
 *  - Where they were last active
 *  - Which channel they prefer (by recent activity)
 *
 * Deterministic — uses SQLite queries only.
 */
export class CrossChannelResolver {
  private readonly db;

  constructor(
    vaultDb: VaultDB,
    private readonly bus: IntelligenceBus,
    private readonly logger: Logger,
  ) {
    this.db = vaultDb.raw();
  }

  /**
   * Build full cross-channel context for a user.
   * Returns channel presence, preference, and online status hint.
   */
  resolve(senderId: string): CrossChannelContext {
    const channels = this.getChannelPresences(senderId);
    const preferredChannel = this.detectPreference(channels);

    // Determine presence hint from most recent activity
    const presenceHint = this.determinePresence(channels);

    return { channels, preferredChannel, presenceHint };
  }

  /**
   * Get per-channel activity data for a user.
   */
  private getChannelPresences(senderId: string): ChannelPresence[] {
    const sevenDaysAgo = Date.now() - 7 * 86_400_000;

    // Query profiles table for all channels this user is on
    const profiles = this.db.prepare(
      "SELECT channel_id, last_seen FROM profiles WHERE sender_id = ? AND last_seen > 0",
    ).all(senderId) as Array<{ channel_id: string; last_seen: number }>;

    // Count recent messages per channel from usage_log
    const usageCounts = this.db.prepare(
      `SELECT channel_id, COUNT(*) as cnt
       FROM usage_log
       WHERE sender_id = ? AND timestamp >= ?
       GROUP BY channel_id`,
    ).all(senderId, sevenDaysAgo) as Array<{ channel_id: string; cnt: number }>;

    const countMap = new Map(usageCounts.map((u) => [u.channel_id, u.cnt]));

    return profiles.map((p) => ({
      channelId: p.channel_id,
      lastMessageAt: p.last_seen,
      messageCountLast7d: countMap.get(p.channel_id) ?? 0,
      topicHint: null, // Could be derived from vault memories but kept simple for now
    }));
  }

  /**
   * Detect the user's preferred channel based on recent activity.
   * Preference = most messages in last 7 days, with recency as tiebreaker.
   */
  private detectPreference(channels: ChannelPresence[]): ChannelPreference {
    if (channels.length === 0) {
      return { channelId: "unknown", confidence: 0, reason: "no_data" };
    }

    if (channels.length === 1) {
      return {
        channelId: channels[0].channelId,
        confidence: 0.9,
        reason: "single_channel",
      };
    }

    // Score: 70% weight on message count, 30% on recency
    const maxCount = Math.max(...channels.map((c) => c.messageCountLast7d), 1);
    const maxRecency = Math.max(...channels.map((c) => c.lastMessageAt), 1);

    let bestChannel = channels[0];
    let bestScore = -1;

    for (const ch of channels) {
      const countScore = ch.messageCountLast7d / maxCount;
      const recencyScore = ch.lastMessageAt / maxRecency;
      const score = countScore * 0.7 + recencyScore * 0.3;

      if (score > bestScore) {
        bestScore = score;
        bestChannel = ch;
      }
    }

    const confidence = channels.length === 1 ? 0.9 : Math.min(0.5 + bestScore * 0.3, 0.85);

    return {
      channelId: bestChannel.channelId,
      confidence,
      reason: `activity_weighted:${bestChannel.messageCountLast7d}msgs_7d`,
    };
  }

  /**
   * Determine online presence hint.
   */
  private determinePresence(channels: ChannelPresence[]): CrossChannelContext["presenceHint"] {
    if (channels.length === 0) return "unknown";

    const now = Date.now();
    const mostRecent = Math.max(...channels.map((c) => c.lastMessageAt));
    const ageMs = now - mostRecent;

    if (ageMs < 300_000) return "online_now"; // < 5 minutes
    if (ageMs < 3_600_000) return "recent"; // < 1 hour
    return "away";
  }

  /**
   * Get cross-channel context formatted for prompt injection.
   */
  getContextForPrompt(senderId: string): string | null {
    const ctx = this.resolve(senderId);
    if (ctx.channels.length <= 1) return null;

    const lines: string[] = ["[CROSS-CHANNEL]"];
    lines.push(`Preferred: ${ctx.preferredChannel.channelId} (${Math.round(ctx.preferredChannel.confidence * 100)}%)`);
    lines.push(`Presence: ${ctx.presenceHint}`);

    for (const ch of ctx.channels) {
      const age = this.formatAge(ch.lastMessageAt);
      lines.push(`  ${ch.channelId}: ${ch.messageCountLast7d} msgs/7d, last ${age} ago`);
    }

    return lines.join("\n");
  }

  private formatAge(timestamp: number): string {
    const ms = Date.now() - timestamp;
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }
}
