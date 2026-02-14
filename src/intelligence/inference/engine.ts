import type { IntelligenceStore } from "../store.js";
import type { IntelligenceBus } from "../bus.js";
import type { DerivedSignal } from "../types.js";
import type { ProfileSignal } from "../../onboarding/types.js";
import type { SignalStore } from "../../onboarding/signals.js";
import type { Logger } from "../../logging/logger.js";

export interface InferenceRule {
  readonly id: string;
  readonly inputSignals: string[];
  readonly minSamples: number;
  readonly cooldownMs: number;
  evaluate(
    raw: ProfileSignal[],
    existing: DerivedSignal | null,
  ): { value: string; confidence: number; evidence: string } | null;
}

export class InferenceEngine {
  constructor(
    private readonly intelligenceStore: IntelligenceStore,
    private readonly signalStore: SignalStore,
    private readonly bus: IntelligenceBus,
    private readonly rules: InferenceRule[],
    private readonly logger: Logger,
  ) {}

  /**
   * Run all inference rules for a given sender.
   * Called after enricher.enrich() in the message pipeline.
   * Returns newly produced/updated derived signals.
   */
  async evaluate(senderId: string, channelId: string): Promise<DerivedSignal[]> {
    const produced: DerivedSignal[] = [];
    const now = Date.now();

    for (const rule of this.rules) {
      try {
        // Check cooldown
        const lastRun = this.intelligenceStore.getLastInferenceRun(rule.id, senderId);
        if (lastRun && now - lastRun < rule.cooldownMs) {
          continue;
        }

        // Load raw signals for this rule
        const rawSignals = this.signalStore.getSignals(senderId, channelId);
        const relevant = rawSignals.filter((s) => rule.inputSignals.includes(s.signalType));

        if (relevant.length < rule.minSamples) {
          this.intelligenceStore.logInference({
            ruleId: rule.id,
            senderId,
            result: "skipped",
            details: JSON.stringify({ reason: "insufficient_samples", count: relevant.length, required: rule.minSamples }),
            executedAt: now,
          });
          continue;
        }

        // Get existing derived signal for this rule
        const existing = this.intelligenceStore.getDerivedSignals(senderId, rule.id).at(0) ?? null;

        // Run the rule
        const result = rule.evaluate(relevant, existing);

        if (!result) {
          this.intelligenceStore.logInference({
            ruleId: rule.id,
            senderId,
            result: "skipped",
            details: null,
            executedAt: now,
          });
          continue;
        }

        // Check if value changed
        if (existing && existing.value === result.value && Math.abs(existing.confidence - result.confidence) < 0.05) {
          this.intelligenceStore.logInference({
            ruleId: rule.id,
            senderId,
            result: "unchanged",
            details: null,
            executedAt: now,
          });
          continue;
        }

        // Write derived signal
        const signal = this.intelligenceStore.writeDerivedSignal({
          senderId,
          channelId,
          signalType: rule.id,
          value: result.value,
          confidence: result.confidence,
          evidence: result.evidence,
        });

        produced.push(signal);

        this.intelligenceStore.logInference({
          ruleId: rule.id,
          senderId,
          result: "produced",
          details: JSON.stringify({ value: result.value, confidence: result.confidence }),
          executedAt: now,
        });

        // Emit to bus
        this.bus.emit({ type: "signal_derived", senderId, signal });

        this.logger.info(
          { ruleId: rule.id, senderId, value: result.value, confidence: result.confidence },
          "Derived signal produced",
        );
      } catch (err) {
        this.logger.error({ err, ruleId: rule.id, senderId }, "Inference rule failed");
      }
    }

    return produced;
  }
}
