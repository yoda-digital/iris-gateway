import type { ArcLifecycle } from "./arcs/lifecycle.js";
import type { GoalLifecycle } from "./goals/lifecycle.js";
import type { OutcomeAnalyzer } from "./outcomes/analyzer.js";
import type { CrossChannelResolver } from "./cross-channel/resolver.js";
import type { HealthGate } from "./health/gate.js";
import type { TriggerResult, PromptSections } from "./types.js";

/**
 * Structured prompt assembler.
 * Replaces ad-hoc string concatenation with independently toggleable sections.
 * Each section is null when there's nothing to inject (no token waste).
 *
 * Called during system prompt transform to build intelligence context.
 */
export class PromptAssembler {
  constructor(
    private readonly arcs: ArcLifecycle | null,
    private readonly goals: GoalLifecycle | null,
    private readonly outcomes: OutcomeAnalyzer | null,
    private readonly crossChannel: CrossChannelResolver | null,
    private readonly healthGate: HealthGate | null,
  ) {}

  /**
   * Assemble all intelligence sections for a user.
   */
  assemble(senderId: string, triggerFlags?: TriggerResult[]): PromptSections {
    return {
      arcs: this.arcs?.getArcContext(senderId) ?? null,
      goals: this.goals?.getGoalContext(senderId) ?? null,
      proactiveContext: this.buildProactiveContext(senderId),
      crossChannel: this.crossChannel?.getContextForPrompt(senderId) ?? null,
      triggerFlags: this.buildTriggerFlags(triggerFlags),
      healthHints: this.healthGate?.getHealthHints() ?? null,
    };
  }

  /**
   * Render all sections into a single string for system prompt injection.
   * Only includes non-null sections.
   */
  render(senderId: string, triggerFlags?: TriggerResult[]): string | null {
    const sections = this.assemble(senderId, triggerFlags);
    const parts: string[] = [];

    if (sections.arcs) parts.push(sections.arcs);
    if (sections.goals) parts.push(sections.goals);
    if (sections.proactiveContext) parts.push(sections.proactiveContext);
    if (sections.crossChannel) parts.push(sections.crossChannel);
    if (sections.triggerFlags) parts.push(sections.triggerFlags);
    if (sections.healthHints) parts.push(sections.healthHints);

    return parts.length > 0 ? parts.join("\n\n") : null;
  }

  /**
   * Build proactive context section from outcome data.
   */
  private buildProactiveContext(senderId: string): string | null {
    if (!this.outcomes) return null;

    const summary = this.outcomes.getSummary(senderId);
    if (summary.rates.length === 0) return null;

    const lines: string[] = ["[PROACTIVE INTELLIGENCE]"];

    // Top performing category
    if (summary.topCategory) {
      const topRate = summary.rates.find((r) => r.category === summary.topCategory);
      if (topRate && topRate.count >= 3) {
        lines.push(`Best category: ${summary.topCategory} (${Math.round(topRate.rate * 100)}% engagement)`);
      }
    }

    // Worst performing category
    if (summary.worstCategory && summary.worstCategory !== summary.topCategory) {
      const worstRate = summary.rates.find((r) => r.category === summary.worstCategory);
      if (worstRate && worstRate.count >= 3 && worstRate.rate < 0.3) {
        lines.push(`Avoid: ${summary.worstCategory} (${Math.round(worstRate.rate * 100)}% engagement — user ignores these)`);
      }
    }

    // Best timing
    if (summary.timing.bestHours.length > 0) {
      const hours = summary.timing.bestHours.slice(0, 3).map((h) => `${h}:00`).join(", ");
      lines.push(`Best hours: ${hours}`);
    }

    return lines.length > 1 ? lines.join("\n") : null;
  }

  /**
   * Build trigger flags section from fired triggers.
   */
  private buildTriggerFlags(triggerFlags?: TriggerResult[]): string | null {
    if (!triggerFlags || triggerFlags.length === 0) return null;

    const flags = triggerFlags
      .filter((t) => t.action === "flag_for_prompt")
      .map((t) => t.payload["flag"] as string)
      .filter(Boolean);

    return flags.length > 0 ? flags.join("\n") : null;
  }
}
