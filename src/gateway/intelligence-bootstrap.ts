import type { VaultDB } from "../vault/db.js";
import type { SignalStore } from "../onboarding/signals.js";
import type { IntentStore } from "../proactive/store.js";
import type { HeartbeatStore } from "../heartbeat/store.js";
import type { Logger } from "../logging/logger.js";
import type { TitleGeneratorFn } from "../intelligence/arcs/detector.js";
import { initIntelligence } from "./intelligence-wiring.js";
import type { IntelligenceBus } from "../intelligence/bus.js";
import type { IntelligenceStore } from "../intelligence/store.js";
import type { InferenceEngine } from "../intelligence/inference/engine.js";
import type { TriggerEvaluator } from "../intelligence/triggers/evaluator.js";
import type { OutcomeAnalyzer } from "../intelligence/outcomes/analyzer.js";
import type { ArcDetector } from "../intelligence/arcs/detector.js";
import type { ArcLifecycle } from "../intelligence/arcs/lifecycle.js";
import type { GoalLifecycle } from "../intelligence/goals/lifecycle.js";
import type { CrossChannelResolver } from "../intelligence/cross-channel/resolver.js";
import type { HealthGate } from "../intelligence/health/gate.js";
import type { PromptAssembler } from "../intelligence/prompt-assembler.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";

export interface IntelligenceComponents {
  intelligenceBus: IntelligenceBus | null;
  intelligenceStore: IntelligenceStore | null;
  inferenceEngine: InferenceEngine | null;
  triggerEvaluator: TriggerEvaluator | null;
  outcomeAnalyzer: OutcomeAnalyzer | null;
  arcDetector: ArcDetector | null;
  arcLifecycle: ArcLifecycle | null;
  goalLifecycle: GoalLifecycle | null;
  crossChannelResolver: CrossChannelResolver | null;
  healthGate: HealthGate | null;
  promptAssembler: PromptAssembler | null;
  trendDetector: any;
}

export async function bootstrapIntelligence(
  bridge: OpenCodeBridge,
  vaultDb: VaultDB,
  signalStore: SignalStore | null,
  intentStore: IntentStore | null,
  heartbeatStore: HeartbeatStore | null,
  logger: Logger
): Promise<IntelligenceComponents> {
  const titleGenerator: TitleGeneratorFn = async (keywords, content) => {
    const session = await bridge.createSession("__arc_title_gen__");
    try {
      const prompt = [
        "Generate a short, human-readable title (3-6 words) for a memory arc.",
        "The title should be in the same language as the content.",
        `Keywords: ${keywords.slice(0, 6).join(", ")}`,
        `Content: ${content.substring(0, 300)}`,
        "Reply with ONLY the title — no quotes, no punctuation, no explanation.",
      ].join("\n");
      const title = await bridge.sendMessage(session.id, prompt);
      return title.trim().replace(/^["']+|["']+$/g, "");
    } finally {
      bridge.deleteSession(session.id).catch(() => {});
    }
  };

  const intel = initIntelligence(vaultDb, signalStore, intentStore, heartbeatStore, logger, titleGenerator);
  const { intelligenceBus, intelligenceStore, inferenceEngine, triggerEvaluator,
    outcomeAnalyzer, arcDetector, arcLifecycle, goalLifecycle,
    crossChannelResolver, healthGate, promptAssembler } = intel;
  const trendDetector = intel.trendDetector;

  return {
    intelligenceBus,
    intelligenceStore,
    inferenceEngine,
    triggerEvaluator,
    outcomeAnalyzer,
    arcDetector,
    arcLifecycle,
    goalLifecycle,
    crossChannelResolver,
    healthGate,
    promptAssembler,
    trendDetector,
  };
}
