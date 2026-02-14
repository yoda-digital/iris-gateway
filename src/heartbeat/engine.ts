import type { HeartbeatStore } from "./store.js";
import type {
  HeartbeatConfig,
  HealthChecker,
  HealthResult,
  HealthStatus,
} from "./types.js";
import type { Logger } from "../logging/logger.js";

export interface HeartbeatEngineDeps {
  store: HeartbeatStore;
  checkers: HealthChecker[];
  logger: Logger;
  config: HeartbeatConfig;
}

interface ComponentState {
  component: string;
  status: HealthStatus;
  healAttempts: number;
  healthyTicks: number;
}

export class HeartbeatEngine {
  private readonly store: HeartbeatStore;
  private readonly checkers: HealthChecker[];
  private readonly logger: Logger;
  private readonly config: HeartbeatConfig;

  private readonly states = new Map<string, ComponentState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: HeartbeatEngineDeps) {
    this.store = deps.store;
    this.checkers = deps.checkers;
    this.logger = deps.logger;
    this.config = deps.config;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error({ err }, "Heartbeat tick error");
      });
    }, this.currentInterval());
    this.timer.unref();
    this.logger.info("Heartbeat engine started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Heartbeat engine stopped");
  }

  async tick(): Promise<void> {
    const results = await Promise.all(
      this.checkers.map((c) => c.check()),
    );

    for (const result of results) {
      this.store.logCheck({
        component: result.component,
        status: result.status,
        latencyMs: result.latencyMs,
        details: result.details,
      });

      const state = this.getOrCreateState(result.component);
      const previousStatus = state.status;

      if (result.status === "healthy") {
        state.healthyTicks++;
        if (
          previousStatus === "recovering" &&
          state.healthyTicks >= this.config.selfHeal.backoffTicks
        ) {
          state.status = "healthy";
          state.healAttempts = 0;
        } else if (previousStatus !== "recovering") {
          state.status = "healthy";
        }
      } else {
        state.healthyTicks = 0;
        state.status = result.status;
      }
    }

    // Self-healing pass
    if (this.config.selfHeal.enabled) {
      for (const result of results) {
        const state = this.states.get(result.component);
        if (!state) continue;

        if (
          (state.status === "down" || state.status === "degraded") &&
          state.healAttempts < this.config.selfHeal.maxAttempts
        ) {
          const checker = this.checkers.find(
            (c) => c.name === result.component,
          );
          if (checker?.heal) {
            const healed = await checker.heal();
            state.healAttempts++;

            this.store.logAction({
              component: result.component,
              action: "self-heal",
              success: healed,
            });

            if (healed) {
              state.status = "recovering";
            }
          }
        }
      }
    }

    this.reschedule();
  }

  currentInterval(): number {
    for (const state of this.states.values()) {
      if (state.status === "down") {
        return this.config.intervals.critical;
      }
    }
    for (const state of this.states.values()) {
      if (state.status === "degraded" || state.status === "recovering") {
        return this.config.intervals.degraded;
      }
    }
    return this.config.intervals.healthy;
  }

  getStatus(): Array<{ component: string; status: HealthStatus }> {
    return Array.from(this.states.values()).map((s) => ({
      component: s.component,
      status: s.status,
    }));
  }

  private reschedule(): void {
    if (this.timer === null) return;

    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error({ err }, "Heartbeat tick error");
      });
    }, this.currentInterval());
    this.timer.unref();
  }

  private getOrCreateState(component: string): ComponentState {
    let state = this.states.get(component);
    if (!state) {
      state = {
        component,
        status: "healthy",
        healAttempts: 0,
        healthyTicks: 0,
      };
      this.states.set(component, state);
    }
    return state;
  }
}
