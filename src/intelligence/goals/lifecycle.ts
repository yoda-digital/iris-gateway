import type { IntelligenceStore } from "../store.js";
import type { IntelligenceBus } from "../bus.js";
import type { Logger } from "../../logging/logger.js";
import type { Goal, GoalStatus } from "../types.js";

/**
 * Goal lifecycle manager.
 * Handles goal state transitions (active → paused → completed/abandoned),
 * due-goal scanning, and prompt context generation.
 *
 * State machine:
 *   active  → paused | completed | abandoned
 *   paused  → active | abandoned
 *   completed (terminal)
 *   abandoned (terminal)
 */
export class GoalLifecycle {
  constructor(
    private readonly store: IntelligenceStore,
    private readonly bus: IntelligenceBus,
    private readonly logger: Logger,
  ) {}

  /**
   * Create a new goal for a user.
   */
  create(params: {
    senderId: string;
    channelId: string;
    description: string;
    arcId?: string;
    successCriteria?: string;
    nextAction?: string;
    nextActionDue?: number;
    priority?: number;
  }): Goal {
    const goal = this.store.createGoal(params);
    this.bus.emit({ type: "goal_created", senderId: params.senderId, goal });
    this.logger.debug({ goalId: goal.id, description: params.description }, "Goal created");
    return goal;
  }

  /**
   * Update goal progress. Adds a progress note and optionally changes next action.
   */
  progress(goalId: string, note: string, nextAction?: string, nextActionDue?: number): Goal | null {
    return this.store.updateGoal(goalId, {
      progressNote: note,
      nextAction: nextAction ?? undefined,
      nextActionDue: nextActionDue ?? undefined,
    });
  }

  /**
   * Transition goal status with validation.
   */
  transition(goalId: string, newStatus: GoalStatus): Goal | null {
    const goal = this.store.getGoal(goalId);
    if (!goal) return null;

    // Validate transition
    if (!this.isValidTransition(goal.status, newStatus)) {
      this.logger.warn(
        { goalId, from: goal.status, to: newStatus },
        "Invalid goal status transition",
      );
      return null;
    }

    return this.store.updateGoal(goalId, { status: newStatus });
  }

  /**
   * Scan for goals with due next-actions.
   * Returns goals that need attention now.
   */
  scanDueGoals(): Goal[] {
    const dueGoals = this.store.getDueGoals();
    for (const goal of dueGoals) {
      this.bus.emit({ type: "goal_due", senderId: goal.senderId, goalId: goal.id });
    }
    return dueGoals;
  }

  /**
   * Scan for stale goals (no updates in 30+ days).
   * These may need a check-in or abandonment.
   */
  scanStaleGoals(): Goal[] {
    return this.store.getStaleGoals();
  }

  /**
   * Get goal context formatted for prompt injection.
   */
  getGoalContext(senderId: string): string | null {
    const active = this.store.getActiveGoals(senderId);
    const paused = this.store.getPausedGoals(senderId);

    if (active.length === 0 && paused.length === 0) return null;

    const lines: string[] = ["[USER GOALS]"];

    if (active.length > 0) {
      lines.push("Active:");
      for (const g of active.slice(0, 5)) {
        const due = g.nextActionDue ? ` (next: ${this.formatDue(g.nextActionDue)})` : "";
        const priority = g.priority > 70 ? " [HIGH]" : g.priority < 30 ? " [low]" : "";
        lines.push(`  - ${g.description}${priority}${due}`);
        if (g.nextAction) {
          lines.push(`    Next action: ${g.nextAction}`);
        }
        if (g.successCriteria) {
          lines.push(`    Success: ${g.successCriteria}`);
        }
      }
    }

    if (paused.length > 0) {
      lines.push("Paused:");
      for (const g of paused.slice(0, 3)) {
        lines.push(`  - ${g.description}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get all goals for a user (for tool server list endpoint).
   */
  listGoals(senderId: string): {
    active: Goal[];
    paused: Goal[];
  } {
    return {
      active: this.store.getActiveGoals(senderId),
      paused: this.store.getPausedGoals(senderId),
    };
  }

  private isValidTransition(from: GoalStatus, to: GoalStatus): boolean {
    const TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
      active: ["paused", "completed", "abandoned"],
      paused: ["active", "abandoned"],
      completed: [],
      abandoned: [],
    };
    return TRANSITIONS[from].includes(to);
  }

  private formatDue(timestamp: number): string {
    const diff = timestamp - Date.now();
    if (diff < 0) return "overdue";
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }
}
