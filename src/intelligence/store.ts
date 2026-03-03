/**
 * IntelligenceStore — thin facade that delegates to domain stores.
 *
 * Domain stores own their schema and methods:
 * - InferenceStore: derived_signals, inference_log
 * - OutcomesStore: proactive_outcomes
 * - ArcsStore: memory_arcs, arc_entries
 * - GoalsStore: goals
 */
import type { VaultDB } from "../vault/db.js";
import { InferenceStore } from "./inference/store.js";
import { OutcomesStore } from "./outcomes/store.js";
import { ArcsStore } from "./arcs/store.js";
import { GoalsStore } from "./goals/store.js";
import type {
  DerivedSignal,
  InferenceLogEntry,
  ProactiveOutcome,
  CategoryRate,
  TimingPattern,
  MemoryArc,
  ArcEntry,
  ArcStatus,
  Goal,
  GoalStatus,
} from "./types.js";

export class IntelligenceStore {
  private readonly inference: InferenceStore;
  private readonly outcomes: OutcomesStore;
  private readonly arcs: ArcsStore;
  private readonly goals: GoalsStore;

  constructor(vaultDb: VaultDB) {
    this.inference = new InferenceStore(vaultDb);
    this.outcomes = new OutcomesStore(vaultDb);
    this.arcs = new ArcsStore(vaultDb);
    this.goals = new GoalsStore(vaultDb);
  }

  // ── Inference delegation ──

  writeDerivedSignal(params: Parameters<InferenceStore["writeDerivedSignal"]>[0]): DerivedSignal {
    return this.inference.writeDerivedSignal(params);
  }
  getDerivedSignal(id: string): DerivedSignal | null {
    return this.inference.getDerivedSignal(id);
  }
  getDerivedSignals(senderId: string, signalType?: string): DerivedSignal[] {
    return this.inference.getDerivedSignals(senderId, signalType);
  }
  logInference(entry: InferenceLogEntry): void {
    return this.inference.logInference(entry);
  }
  getLastInferenceRun(ruleId: string, senderId: string): number | null {
    return this.inference.getLastInferenceRun(ruleId, senderId);
  }

  // ── Outcomes delegation ──

  recordOutcome(params: Parameters<OutcomesStore["recordOutcome"]>[0]): ProactiveOutcome {
    return this.outcomes.recordOutcome(params);
  }
  markEngaged(senderId: string, engagedAt: number, quality: string): boolean {
    return this.outcomes.markEngaged(senderId, engagedAt, quality);
  }
  getCategoryRates(senderId: string, windowDays?: number): CategoryRate[] {
    return this.outcomes.getCategoryRates(senderId, windowDays);
  }
  getTimingPatterns(senderId: string, windowDays?: number): TimingPattern {
    return this.outcomes.getTimingPatterns(senderId, windowDays);
  }
  getOutcome(id: string): ProactiveOutcome | null {
    return this.outcomes.getOutcome(id);
  }

  // ── Arcs delegation ──

  createArc(params: Parameters<ArcsStore["createArc"]>[0]): MemoryArc {
    return this.arcs.createArc(params);
  }
  addArcEntry(params: Parameters<ArcsStore["addArcEntry"]>[0]): ArcEntry {
    return this.arcs.addArcEntry(params);
  }
  getArc(id: string): MemoryArc | null {
    return this.arcs.getArc(id);
  }
  getActiveArcs(senderId: string): MemoryArc[] {
    return this.arcs.getActiveArcs(senderId);
  }
  getArcsBySender(senderId: string): MemoryArc[] {
    return this.arcs.getArcsBySender(senderId);
  }
  getArcEntries(arcId: string): ArcEntry[] {
    return this.arcs.getArcEntries(arcId);
  }
  getStaleArcs(defaultStaleDays?: number): MemoryArc[] {
    return this.arcs.getStaleArcs(defaultStaleDays);
  }
  updateArcStatus(arcId: string, status: ArcStatus): void {
    return this.arcs.updateArcStatus(arcId, status);
  }
  findArcByKeywords(senderId: string, keywords: string[]): MemoryArc | null {
    return this.arcs.findArcByKeywords(senderId, keywords);
  }

  // ── Goals delegation ──

  createGoal(params: Parameters<GoalsStore["createGoal"]>[0]): Goal {
    return this.goals.createGoal(params);
  }
  getGoal(id: string): Goal | null {
    return this.goals.getGoal(id);
  }
  getActiveGoals(senderId: string): Goal[] {
    return this.goals.getActiveGoals(senderId);
  }
  getPausedGoals(senderId: string): Goal[] {
    return this.goals.getPausedGoals(senderId);
  }
  getDueGoals(): Goal[] {
    return this.goals.getDueGoals();
  }
  updateGoal(id: string, params: Parameters<GoalsStore["updateGoal"]>[1]): Goal | null {
    return this.goals.updateGoal(id, params);
  }
  getStaleGoals(defaultStaleDays?: number): Goal[] {
    return this.goals.getStaleGoals(defaultStaleDays);
  }
}
