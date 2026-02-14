import type { IntelligenceStore } from "../store.js";
import type { IntelligenceBus } from "../bus.js";
import type { Logger } from "../../logging/logger.js";

/**
 * Memory arc detector.
 * When new vault facts (memories) are stored, this checks whether they
 * belong to an existing arc or should start a new one.
 *
 * Deterministic keyword overlap — no AI.
 *
 * An arc is a temporal narrative thread: a sequence of related facts
 * that track an evolving situation (e.g., "job search", "wedding planning").
 */
export class ArcDetector {
  constructor(
    private readonly store: IntelligenceStore,
    private readonly bus: IntelligenceBus,
    private readonly logger: Logger,
  ) {}

  /**
   * Process a new memory/fact and attach it to an arc.
   * If no matching arc exists and the content is substantial enough,
   * creates a new arc.
   *
   * @param senderId - The user's ID
   * @param content  - The memory content (fact text)
   * @param memoryId - Optional vault memory ID to link
   * @param source   - Where this came from (conversation, compaction, etc.)
   */
  processMemory(
    senderId: string,
    content: string,
    memoryId?: string,
    source: "conversation" | "compaction" | "proactive" | "tool" = "conversation",
  ): void {
    const keywords = this.extractKeywords(content);

    // Need at least 2 keywords to be meaningful
    if (keywords.length < 2) return;

    // Try to match an existing active arc
    const matchedArc = this.store.findArcByKeywords(senderId, keywords);

    if (matchedArc) {
      this.store.addArcEntry({
        arcId: matchedArc.id,
        content,
        source,
        memoryId,
      });
      this.logger.debug(
        { arcId: matchedArc.id, title: matchedArc.title },
        "Memory added to existing arc",
      );
      return;
    }

    // No match — create a new arc if content is substantial
    if (keywords.length >= 3 && content.length >= 30) {
      const title = this.generateTitle(keywords);
      const arc = this.store.createArc({
        senderId,
        title,
        summary: content.substring(0, 200),
      });

      this.store.addArcEntry({
        arcId: arc.id,
        content,
        source,
        memoryId,
      });

      this.bus.emit({ type: "arc_created", senderId, arc });
      this.logger.info({ arcId: arc.id, title }, "New memory arc created");
    }
  }

  /**
   * Check for stale arcs and emit events.
   * Called periodically (e.g., from PulseEngine passive scan).
   */
  scanStaleArcs(): void {
    const staleArcs = this.store.getStaleArcs();
    for (const arc of staleArcs) {
      this.store.updateArcStatus(arc.id, "stale");
      this.bus.emit({ type: "arc_stale", senderId: arc.senderId, arcId: arc.id });
      this.logger.info(
        { arcId: arc.id, title: arc.title },
        "Arc marked stale",
      );
    }
  }

  /**
   * Extract meaningful keywords from text.
   * Filters out stop words and short tokens.
   */
  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);
  }

  /**
   * Generate a human-readable arc title from keywords.
   * Takes the first 3-4 most distinctive words.
   */
  private generateTitle(keywords: string[]): string {
    const unique = [...new Set(keywords)].slice(0, 4);
    return unique.join(" ");
  }
}
