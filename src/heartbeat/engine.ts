import type { HeartbeatStore } from "./store.js";
import type {
  HeartbeatConfig,
  HealthChecker,
  HealthResult,
  HealthStatus,
  HeartbeatAgentConfig,
} from "./types.js";
import type { Logger } from "../logging/logger.js";
import { isWithinActiveHours } from "./active-hours.js";
import { shouldSkipEmptyCheck, hashStatuses, computeBackoffInterval, type EmptyCheckState } from "./empty-check.js";
import { HeartbeatCoalescer } from "./coalesce.js";

export interface HeartbeatEngineDeps {
  store: HeartbeatStore;
  checkers: HealthChecker[];
  logger: Logger;
  config: HeartbeatConfig;
  getQueueSize?: () => number;
  userTimezone?: string;
}

interface ComponentState {
  component: string;
  status: HealthStatus;
  healAttempts: number;
  healthyTicks: number;
}

interface AgentState {
  agentId: string;
  components: Map<string, ComponentState>;
  emptyCheck: EmptyCheckState;
  lastRunMs: number;
  nextDueMs: number;
  intervals: HeartbeatConfig["intervals"];
  activeHours?: HeartbeatConfig["activeHours"];
}

export class HeartbeatEngine {
  private readonly store: HeartbeatStore;
  private readonly checkers: HealthChecker[];
  private readonly logger: Logger;
  private readonly config: HeartbeatConfig;
  private readonly getQueueSize: () => number;

  private readonly agents = new Map<string, AgentState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private coalescer: HeartbeatCoalescer | null = null;

  constructor(deps: HeartbeatEngineDeps) {
    this.store = deps.store;
    this.checkers = deps.checkers;
    this.logger = deps.logger;
    this.config = deps.config;
    this.getQueueSize = deps.getQueueSize ?? (() => 0);

    // Initialize agents
    const agentConfigs = this.config.agents;
    if (agentConfigs && agentConfigs.length > 0) {
      for (const ac of agentConfigs) {
        this.agents.set(ac.agentId, this.createAgentState(ac));
      }
    } else {
      this.agents.set("default", this.createAgentState({ agentId: "default" }));
    }

    // Initialize coalescer if configured
    if (this.config.coalesceMs && this.config.coalesceMs > 0) {
      this.coalescer = new HeartbeatCoalescer({
        coalesceMs: this.config.coalesceMs,
        retryMs: this.config.retryMs ?? 1_000,
        getQueueSize: this.getQueueSize,
      });
    }
  }

  start(): void {
    const interval = this.shortestInterval();
    this.timer = setInterval(() => {
      this.tickAll().catch((err) => {
        this.logger.error({ err }, "Heartbeat tick error");
      });
    }, interval);
    this.timer.unref();
    this.logger.info({ agents: this.agents.size }, "Heartbeat engine started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.coalescer) this.coalescer.dispose();
    this.logger.info("Heartbeat engine stopped");
  }

  async tick(): Promise<void> {
    return this.tickAll();
  }

  async tickAll(): Promise<void> {
    const now = Date.now();
    for (const [, agent] of this.agents) {
      if (now < agent.nextDueMs) continue;
      await this.tickAgent(agent);
    }
  }

  currentInterval(): number {
    for (const agent of this.agents.values()) {
      for (const state of agent.components.values()) {
        if (state.status === "down") return this.config.intervals.critical;
      }
    }
    for (const agent of this.agents.values()) {
      for (const state of agent.components.values()) {
        if (state.status === "degraded" || state.status === "recovering") return this.config.intervals.degraded;
      }
    }
    return this.config.intervals.healthy;
  }

  getStatus(): Array<{ agentId: string; component: string; status: HealthStatus }> {
    const result: Array<{ agentId: string; component: string; status: HealthStatus }> = [];
    for (const [agentId, agent] of this.agents) {
      for (const state of agent.components.values()) {
        result.push({ agentId, component: state.component, status: state.status });
      }
    }
    return result;
  }

  private async tickAgent(agent: AgentState): Promise<void> {
    const agentActiveHours = agent.activeHours ?? this.config.activeHours;
    if (!isWithinActiveHours(agentActiveHours)) {
      this.logger.debug({ agentId: agent.agentId }, "Outside active hours, skipping");
      agent.nextDueMs = Date.now() + this.getAgentInterval(agent);
      return;
    }

    const runChecks = async (): Promise<void> => {
      const results = await Promise.all(this.checkers.map((c) => c.check()));

      // Empty check
      const currentStatuses = results.map((r) => ({ component: r.component, status: r.status }));
      const hash = hashStatuses(currentStatuses);
      const allHealthy = results.every((r) => r.status === "healthy");
      const emptyCheckEnabled = this.config.emptyCheck?.enabled ?? false;

      if (allHealthy && shouldSkipEmptyCheck(emptyCheckEnabled, agent.emptyCheck, hash)) {
        this.logger.debug({ agentId: agent.agentId }, "Empty check skip");
        this.rescheduleAgent(agent, true);
        return;
      }
      if (!allHealthy) {
        agent.emptyCheck.consecutiveEmpty = 0;
        agent.emptyCheck.previousHash = "";
      }

      for (const result of results) {
        this.store.logCheck({
          component: result.component,
          status: result.status,
          latencyMs: result.latencyMs,
          details: result.details,
          agentId: agent.agentId,
        });

        const state = this.getOrCreateState(agent, result.component);
        const previousStatus = state.status;

        if (result.status === "healthy") {
          state.healthyTicks++;
          if (previousStatus === "recovering" && state.healthyTicks >= this.config.selfHeal.backoffTicks) {
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
          const state = agent.components.get(result.component);
          if (!state) continue;
          if (
            (state.status === "down" || state.status === "degraded") &&
            state.healAttempts < this.config.selfHeal.maxAttempts
          ) {
            const checker = this.checkers.find((c) => c.name === result.component);
            if (checker?.heal) {
              const healed = await checker.heal();
              state.healAttempts++;
              this.store.logAction({
                component: result.component,
                action: "self-heal",
                success: healed,
                agentId: agent.agentId,
              });
              if (healed) state.status = "recovering";
            }
          }
        }
      }

      this.rescheduleAgent(agent, allHealthy);
    };

    if (this.coalescer) {
      this.coalescer.requestRun(runChecks);
    } else {
      await runChecks();
    }
  }

  private rescheduleAgent(agent: AgentState, allHealthy: boolean): void {
    let interval = this.getAgentInterval(agent);
    if (allHealthy && this.config.emptyCheck?.enabled) {
      interval = computeBackoffInterval(
        interval,
        agent.emptyCheck.consecutiveEmpty,
        this.config.emptyCheck.maxBackoffMs ?? 300_000,
      );
    }
    agent.lastRunMs = Date.now();
    agent.nextDueMs = Date.now() + interval;

    if (this.timer !== null) {
      clearInterval(this.timer);
      const nextInterval = this.shortestInterval();
      this.timer = setInterval(() => {
        this.tickAll().catch((err) => {
          this.logger.error({ err }, "Heartbeat tick error");
        });
      }, nextInterval);
      this.timer.unref();
    }
  }

  private getAgentInterval(agent: AgentState): number {
    for (const state of agent.components.values()) {
      if (state.status === "down") return agent.intervals.critical;
    }
    for (const state of agent.components.values()) {
      if (state.status === "degraded" || state.status === "recovering") return agent.intervals.degraded;
    }
    return agent.intervals.healthy;
  }

  private shortestInterval(): number {
    let shortest = Infinity;
    for (const agent of this.agents.values()) {
      const interval = this.getAgentInterval(agent);
      if (interval < shortest) shortest = interval;
    }
    return shortest === Infinity ? this.config.intervals.healthy : shortest;
  }

  private createAgentState(ac: Partial<HeartbeatAgentConfig> & { agentId: string }): AgentState {
    return {
      agentId: ac.agentId,
      components: new Map(),
      emptyCheck: { previousHash: "", consecutiveEmpty: 0 },
      lastRunMs: 0,
      nextDueMs: 0,
      intervals: {
        healthy: ac.intervals?.healthy ?? this.config.intervals.healthy,
        degraded: ac.intervals?.degraded ?? this.config.intervals.degraded,
        critical: ac.intervals?.critical ?? this.config.intervals.critical,
      },
      activeHours: ac.activeHours,
    };
  }

  private getOrCreateState(agent: AgentState, component: string): ComponentState {
    let state = agent.components.get(component);
    if (!state) {
      state = { component, status: "healthy", healAttempts: 0, healthyTicks: 0 };
      agent.components.set(component, state);
    }
    return state;
  }
}
