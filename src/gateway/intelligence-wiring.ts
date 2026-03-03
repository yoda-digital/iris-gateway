import type { IrisConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type { VaultDB } from "../vault/db.js";
import type { VaultStore } from "../vault/store.js";
import type { SignalStore } from "../onboarding/signals.js";
import type { IntentStore } from "../proactive/store.js";
import type { HeartbeatStore } from "../heartbeat/store.js";
import { IntelligenceBus } from "../intelligence/bus.js";
import { IntelligenceStore } from "../intelligence/store.js";
import { InferenceEngine } from "../intelligence/inference/engine.js";
import { builtinInferenceRules } from "../intelligence/inference/rules/index.js";
import { TriggerEvaluator } from "../intelligence/triggers/evaluator.js";
import { OutcomeAnalyzer } from "../intelligence/outcomes/analyzer.js";
import { ArcDetector } from "../intelligence/arcs/detector.js";
import type { TitleGeneratorFn } from "../intelligence/arcs/detector.js";
import { ArcLifecycle } from "../intelligence/arcs/lifecycle.js";
import { GoalLifecycle } from "../intelligence/goals/lifecycle.js";
import { CrossChannelResolver } from "../intelligence/cross-channel/resolver.js";
import { TrendDetector } from "../intelligence/health/trend-detector.js";
import { HealthGate } from "../intelligence/health/gate.js";
import { PromptAssembler } from "../intelligence/prompt-assembler.js";

export interface IntelligenceComponents {
  intelligenceBus: IntelligenceBus;
  intelligenceStore: IntelligenceStore;
  inferenceEngine: InferenceEngine | null;
  triggerEvaluator: TriggerEvaluator;
  outcomeAnalyzer: OutcomeAnalyzer;
  arcDetector: ArcDetector;
  arcLifecycle: ArcLifecycle;
  goalLifecycle: GoalLifecycle;
  crossChannelResolver: CrossChannelResolver;
  trendDetector: TrendDetector | null;
  healthGate: HealthGate | null;
  promptAssembler: PromptAssembler;
}

/**
 * Initialize the full intelligence subsystem:
 * bus, store, inference, triggers, outcomes, arcs, goals, cross-channel, health gate, prompt assembler.
 */
export function initIntelligence(
  vaultDb: VaultDB,
  signalStore: SignalStore | null,
  intentStore: IntentStore | null,
  heartbeatStore: HeartbeatStore | null,
  logger: Logger,
  titleGenerator?: TitleGeneratorFn,
): IntelligenceComponents {
  const intelligenceBus = new IntelligenceBus();
  const intelligenceStore = new IntelligenceStore(vaultDb);

  // Phase 1: Inference engine + triggers
  const inferenceEngine = signalStore
    ? new InferenceEngine(intelligenceStore, signalStore, intelligenceBus, builtinInferenceRules, logger)
    : null;
  const triggerEvaluator = new TriggerEvaluator(intelligenceStore, intentStore, intelligenceBus, logger);

  // Phase 2: Outcomes + arcs
  const outcomeAnalyzer = new OutcomeAnalyzer(intelligenceStore, intelligenceBus, logger);
  const arcDetector = new ArcDetector(intelligenceStore, intelligenceBus, logger, titleGenerator);
  const arcLifecycle = new ArcLifecycle(intelligenceStore, intelligenceBus, logger);

  // Phase 3: Goals + cross-channel
  const goalLifecycle = new GoalLifecycle(intelligenceStore, intelligenceBus, logger);
  const crossChannelResolver = new CrossChannelResolver(vaultDb, intelligenceBus, logger);

  // Phase 4: Health trends + gate (requires heartbeat store)
  let trendDetector: TrendDetector | null = null;
  let healthGate: HealthGate | null = null;
  if (heartbeatStore) {
    trendDetector = new TrendDetector(vaultDb, logger);
    healthGate = new HealthGate(heartbeatStore, trendDetector, intelligenceBus, logger);
  }

  // Prompt assembler — wires all context providers
  const promptAssembler = new PromptAssembler(
    arcLifecycle,
    goalLifecycle,
    outcomeAnalyzer,
    crossChannelResolver,
    healthGate,
  );

  logger.info(
    "Intelligence layer initialized (bus, store, inference, triggers, outcomes, arcs, goals, cross-channel, health gate, prompt assembler)",
  );

  return {
    intelligenceBus, intelligenceStore, inferenceEngine, triggerEvaluator,
    outcomeAnalyzer, arcDetector, arcLifecycle, goalLifecycle,
    crossChannelResolver, trendDetector, healthGate, promptAssembler,
  };
}
