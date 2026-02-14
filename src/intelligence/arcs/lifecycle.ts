import type { IntelligenceStore } from "../store.js";
import type { IntelligenceBus } from "../bus.js";
import type { Logger } from "../../logging/logger.js";
import type { ArcStatus, MemoryArc } from "../types.js";

/**
 * Arc lifecycle manager.
 * Handles status transitions and provides arc context
 * for prompt injection and proactive follow-ups.
 */
export class ArcLifecycle {
  constructor(
    private readonly store: IntelligenceStore,
    private readonly bus: IntelligenceBus,
    private readonly logger: Logger,
  ) {}

  /**
   * Resolve an arc — the situation has concluded.
   */
  resolve(arcId: string, summary?: string): void {
    if (summary) {
      const arc = this.store.getArc(arcId);
      if (arc) {
        // Add a final summary entry
        this.store.addArcEntry({
          arcId,
          content: `[RESOLVED] ${summary}`,
          source: "tool",
        });
      }
    }
    this.store.updateArcStatus(arcId, "resolved");
    this.logger.debug({ arcId }, "Arc resolved");
  }

  /**
   * Abandon an arc — no longer relevant.
   */
  abandon(arcId: string): void {
    this.store.updateArcStatus(arcId, "abandoned");
    this.logger.debug({ arcId }, "Arc abandoned");
  }

  /**
   * Reactivate a stale arc — user brought it up again.
   */
  reactivate(arcId: string): void {
    this.store.updateArcStatus(arcId, "active");
    this.logger.debug({ arcId }, "Arc reactivated");
  }

  /**
   * Get active arcs formatted for prompt injection.
   * Returns a compact string suitable for system prompt context.
   */
  getArcContext(senderId: string): string | null {
    const arcs = this.store.getActiveArcs(senderId);
    if (arcs.length === 0) return null;

    const lines: string[] = ["[ACTIVE NARRATIVE ARCS]"];
    for (const arc of arcs.slice(0, 5)) { // Max 5 arcs in prompt
      const entries = this.store.getArcEntries(arc.id);
      const age = this.formatAge(arc.createdAt);
      const lastUpdate = this.formatAge(arc.updatedAt);
      const entryCount = entries.length;

      lines.push(`- "${arc.title}" (${age} old, ${entryCount} entries, updated ${lastUpdate} ago)`);
      if (arc.summary) {
        lines.push(`  Latest: ${arc.summary.substring(0, 120)}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get stale arcs that might need a follow-up.
   * Used by the proactive engine to generate check-in prompts.
   */
  getStaleArcsForFollowUp(senderId: string): MemoryArc[] {
    return this.store.getStaleArcs().filter((a) => a.senderId === senderId);
  }

  private formatAge(timestamp: number): string {
    const ms = Date.now() - timestamp;
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w`;
  }
}
