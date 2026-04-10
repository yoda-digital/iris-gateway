import type { ChannelRegistry } from "../channels/registry.js";
import type { IntelligenceStore } from "../intelligence/store.js";
import type { Logger } from "../logging/logger.js";
import type { SessionMap } from "./session-map.js";

export class CompactionNotifier {
  constructor(
    private readonly sessionMap: SessionMap,
    private readonly registry: ChannelRegistry,
    private readonly logger: Logger,
    private readonly intelligenceStore: IntelligenceStore | null,
  ) {}

  async notify(sessionId: string): Promise<void> {
    const entry = await this.sessionMap.findBySessionId(sessionId);
    if (!entry) {
      this.logger.warn({ sessionId }, "Compaction notification skipped: no session entry");
      return;
    }

    const adapter = this.registry.get(entry.channelId);
    if (!adapter) {
      this.logger.warn({ channelId: entry.channelId }, "Compaction notification skipped: no adapter");
      return;
    }

    try {
      await adapter.sendText({ to: entry.chatId, text: this.buildMessage(entry.senderId) });
      this.logger.info({ sessionId, senderId: entry.senderId }, "Compaction notification sent");
    } catch (err) {
      this.logger.warn({ err, sessionId }, "Failed to send compaction notification");
    }
  }

  buildMessage(senderId: string): string {
    if (!this.intelligenceStore) return "Context refreshed.";

    const parts: string[] = [];
    const activeGoals = this.intelligenceStore.getActiveGoals(senderId);
    const pausedGoals = this.intelligenceStore.getPausedGoals(senderId);
    const goalCount = activeGoals.length + pausedGoals.length;
    if (goalCount > 0) {
      parts.push(`${goalCount} goal${goalCount === 1 ? "" : "s"}`);
    }

    const activeArcs = this.intelligenceStore.getActiveArcs(senderId);
    if (activeArcs.length > 0) {
      parts.push(`${activeArcs.length} memory arc${activeArcs.length === 1 ? "" : "s"}`);
    }

    if (parts.length === 0) return "Context refreshed.";
    return `Context refreshed after compaction. Currently tracking: ${parts.join(", ")}.`;
  }
}
