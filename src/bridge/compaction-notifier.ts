import type { GoalLifecycle } from "../intelligence/goals/lifecycle.js";
import type { ArcLifecycle } from "../intelligence/arcs/lifecycle.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { Logger } from "../logging/logger.js";

export class CompactionNotifier {
  constructor(
    private readonly goalLifecycle: GoalLifecycle,
    private readonly arcLifecycle: ArcLifecycle,
    private readonly registry: ChannelRegistry,
    private readonly logger: Logger,
    private readonly enabled: boolean = true,
  ) {}

  async notify(senderId: string, channelId: string): Promise<void> {
    if (!this.enabled) {
      this.logger.debug({ senderId, channelId }, "Compaction notifier disabled");
      return;
    }

    const adapter = this.registry.get(channelId);
    if (!adapter) {
      this.logger.warn({ channelId }, "No adapter for compaction notification");
      return;
    }

    const goalContext = this.goalLifecycle.getGoalContext(senderId);
    const arcContext = this.arcLifecycle.getArcContext(senderId);

    const activeGoals = goalContext ? this.countActiveGoals(goalContext) : 0;
    const activeArcs = arcContext ? this.countActiveArcs(arcContext) : 0;

    const message = `Context refreshed after compaction. Currently tracking: ${activeGoals} active goals, ${activeArcs} memory arcs.`;

    try {
      await adapter.sendText({ to: channelId, text: message });
      this.logger.info({ senderId, channelId, activeGoals, activeArcs }, "Compaction notification sent");
    } catch (err) {
      this.logger.error({ err, senderId, channelId }, "Failed to send compaction notification");
    }
  }

  private countActiveGoals(context: string): number {
    const activeMatch = context.match(/Active:\s*\n([\s\S]*?)(?:\nPaused:|$)/);
    if (!activeMatch) return 0;
    const activeSection = activeMatch[1];
    const goalLines = activeSection.split("\n").filter((line) => line.trim().startsWith("-"));
    return goalLines.length;
  }

  private countActiveArcs(context: string): number {
    const arcLines = context.split("\n").filter((line) => line.trim().startsWith("- "));
    return arcLines.length;
  }
}
