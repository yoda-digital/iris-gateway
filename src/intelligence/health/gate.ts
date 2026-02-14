import type { HeartbeatStore } from "../../heartbeat/store.js";
import type { Logger } from "../../logging/logger.js";
import type { IntelligenceBus } from "../bus.js";
import type { TrendDetector } from "./trend-detector.js";
import type { ThrottleLevel, HealthGateResult, TrendResult } from "../types.js";

/**
 * Health gate for the proactive engine.
 * Checks system health before allowing proactive messages.
 * Throttles or pauses proactive activity when the system is degraded.
 *
 * Levels:
 *  - normal:  All systems healthy, full proactive activity
 *  - reduced: Some degradation, reduce proactive frequency by 50%
 *  - minimal: Significant issues, only critical proactive messages
 *  - paused:  System is too unhealthy for any proactive activity
 */
export class HealthGate {
  private currentThrottle: ThrottleLevel = "normal";
  private lastCheck = 0;
  private readonly CHECK_INTERVAL_MS = 60_000; // Re-evaluate every minute

  constructor(
    private readonly heartbeatStore: HeartbeatStore,
    private readonly trendDetector: TrendDetector,
    private readonly bus: IntelligenceBus,
    private readonly logger: Logger,
  ) {}

  /**
   * Check if the system is healthy enough for proactive activity.
   * Caches result for CHECK_INTERVAL_MS to avoid excessive queries.
   */
  check(channelIds?: string[]): HealthGateResult {
    const now = Date.now();

    // Use cached result if recent enough
    if (now - this.lastCheck < this.CHECK_INTERVAL_MS) {
      return {
        throttle: this.currentThrottle,
        availableChannels: channelIds ?? [],
        queuedChannels: [],
        reason: "cached",
      };
    }

    this.lastCheck = now;
    const latestStatus = this.heartbeatStore.getLatestStatus();
    const trends = this.trendDetector.analyzeAll();

    // Count unhealthy components
    let unhealthyCount = 0;
    let criticalCount = 0;
    const degradedChannels: string[] = [];

    for (const [component, status] of latestStatus) {
      if (status === "unhealthy" || status === "error") {
        unhealthyCount++;
        // Check if it's a channel component
        if (component.startsWith("channel:")) {
          degradedChannels.push(component.replace("channel:", ""));
        }
      }
      if (status === "critical") criticalCount++;
    }

    // Check for critical trajectory in trends
    const criticalTrajectories = trends.filter(
      (t) => t.trend === "critical_trajectory",
    );

    // Determine throttle level
    let newThrottle: ThrottleLevel;
    let reason: string;

    if (criticalCount > 0 || criticalTrajectories.length > 0) {
      newThrottle = "paused";
      reason = `critical:${criticalCount} components, ${criticalTrajectories.length} trajectories`;
    } else if (unhealthyCount >= 3) {
      newThrottle = "minimal";
      reason = `degraded:${unhealthyCount} unhealthy components`;
    } else if (unhealthyCount >= 1) {
      newThrottle = "reduced";
      reason = `partially_degraded:${unhealthyCount} unhealthy components`;
    } else {
      newThrottle = "normal";
      reason = "all_healthy";
    }

    // Emit event on throttle change
    if (newThrottle !== this.currentThrottle) {
      this.bus.emit({
        type: "health_changed",
        component: "health_gate",
        status: newThrottle,
      });
      this.logger.info(
        { from: this.currentThrottle, to: newThrottle, reason },
        "Health gate throttle changed",
      );
      this.currentThrottle = newThrottle;
    }

    // Determine which channels are available vs queued
    const available = (channelIds ?? []).filter(
      (ch) => !degradedChannels.includes(ch),
    );
    const queued = (channelIds ?? []).filter((ch) =>
      degradedChannels.includes(ch),
    );

    return {
      throttle: this.currentThrottle,
      availableChannels: available,
      queuedChannels: queued,
      reason,
    };
  }

  /**
   * Whether proactive activity should proceed at current throttle level.
   */
  shouldProceed(priority: "critical" | "normal" | "low" = "normal"): boolean {
    switch (this.currentThrottle) {
      case "normal":
        return true;
      case "reduced":
        // Skip low priority, allow normal and critical
        return priority !== "low";
      case "minimal":
        // Only critical priority
        return priority === "critical";
      case "paused":
        return false;
    }
  }

  /**
   * Get health context formatted for prompt injection.
   */
  getHealthHints(): string | null {
    if (this.currentThrottle === "normal") return null;

    const trends = this.trendDetector.analyzeAll();
    const degrading = trends.filter((t) => t.trend === "degrading" || t.trend === "critical_trajectory");

    if (degrading.length === 0) return null;

    const lines: string[] = [`[SYSTEM HEALTH: ${this.currentThrottle.toUpperCase()}]`];

    for (const t of degrading) {
      const predicted = t.predictedThresholdIn
        ? ` (predicted breach in ${Math.round(t.predictedThresholdIn / 3_600_000)}h)`
        : "";
      lines.push(`- ${t.component}/${t.metric}: ${t.trend}${predicted}`);
    }

    return lines.join("\n");
  }

  getCurrentThrottle(): ThrottleLevel {
    return this.currentThrottle;
  }
}
