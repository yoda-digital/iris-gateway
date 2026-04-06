import type { Logger } from "../logging/logger.js";
import type { SessionMap } from "./session-map.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { IntelligenceStore } from "../intelligence/store.js";

export interface CompactionNotifierConfig {
  readonly enabled: boolean;
}

/**
 * CompactionNotifier
 *
 * Sends intelligence-aware compaction notifications to users when their
 * OpenCode session is compacted. Pulls active goals and arcs from the
 * intelligence layer to help users understand what context is still tracked.
 */
export class CompactionNotifier {
  constructor(
    private readonly sessionMap: SessionMap,
    private readonly registry: ChannelRegistry,
    private readonly intelligenceStore: IntelligenceStore | null,
    private readonly logger: Logger,
  ) {}

  /**
   * Notify user that their session was compacted.
   * Resolves sessionId → senderId, pulls intelligence context, and formats
   * a brief message showing what's still being tracked.
   *
   * @param sessionId OpenCode session ID
   * @param channelId Channel ID (for sending the notification)
   * @param chatId Chat ID (for sending the notification)
   * @param config Per-channel config (checked for notifyOnCompaction flag)
   */
  async notify(
    sessionId: string,
    channelId: string,
    chatId: string,
    config: CompactionNotifierConfig,
  ): Promise<void> {
    if (!config.enabled) {
      this.logger.debug({ sessionId }, "Compaction notification disabled by config");
      return;
    }

    const adapter = this.registry.get(channelId);
    if (!adapter) {
      this.logger.warn({ channelId, sessionId }, "No adapter found for compaction notification");
      return;
    }

    // Resolve sessionId → senderId
    const entry = await this.sessionMap.findBySessionId(sessionId);
    if (!entry) {
      this.logger.warn({ sessionId }, "Session not found in map — cannot resolve senderId");
      const fallback = "Context refreshed after compaction.";
      await adapter.sendText({ to: chatId, text: fallback }).catch((err) =>
        this.logger.warn({ err, sessionId }, "Failed to send fallback compaction notification"),
      );
      return;
    }

    const { senderId } = entry;

    // Pull intelligence context counts
    let goalCount = 0;
    let arcCount = 0;

    if (this.intelligenceStore) {
      try {
        const activeGoals = this.intelligenceStore.getActiveGoals(senderId);
        const activeArcs = this.intelligenceStore.getActiveArcs(senderId);
        goalCount = activeGoals.length;
        arcCount = activeArcs.length;
      } catch (err) {
        this.logger.warn({ err, senderId }, "Failed to fetch intelligence context for compaction notification");
      }
    }

    // Format message
    const message = this.formatMessage(goalCount, arcCount);

    // Send notification
    await adapter.sendText({ to: chatId, text: message }).catch((err) =>
      this.logger.warn({ err, sessionId }, "Failed to send compaction notification"),
    );

    this.logger.info(
      { sessionId, senderId, goals: goalCount, arcs: arcCount },
      "Compaction notification sent",
    );
  }

  private formatMessage(goalCount: number, arcCount: number): string {
    if (goalCount === 0 && arcCount === 0) {
      return "Context refreshed after compaction.";
    }

    const parts: string[] = ["Context refreshed after compaction. Currently tracking:"];
    if (goalCount > 0) {
      parts.push(`${goalCount} active goal${goalCount === 1 ? "" : "s"}`);
    }
    if (arcCount > 0) {
      parts.push(`${arcCount} memory arc${arcCount === 1 ? "" : "s"}`);
    }

    return parts.join(" ");
  }
}
