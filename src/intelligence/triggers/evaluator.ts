import type { IntelligenceStore } from "../store.js";
import type { IntelligenceBus } from "../bus.js";
import type { DerivedSignal, TriggerResult } from "../types.js";
import type { IntentStore } from "../../proactive/store.js";
import type { InboundMessage } from "../../channels/adapter.js";
import type { Logger } from "../../logging/logger.js";
import { builtinTriggerRules, type TriggerRule } from "./rules.js";

/**
 * Event-driven trigger evaluator.
 * Runs synchronously in the message pipeline — no AI calls.
 * Matches messages against deterministic rules and fires actions.
 */
export class TriggerEvaluator {
  private readonly rules: TriggerRule[];

  constructor(
    private readonly intelligenceStore: IntelligenceStore,
    private readonly intentStore: IntentStore | null,
    private readonly bus: IntelligenceBus,
    private readonly logger: Logger,
    customRules?: TriggerRule[],
  ) {
    this.rules = [...builtinTriggerRules, ...(customRules ?? [])];
  }

  /**
   * Evaluate all trigger rules against an inbound message.
   * Called in handleInbound() between enrichment and session resolution.
   * Returns prompt flags that should be injected into the system prompt.
   */
  evaluate(
    msg: InboundMessage,
    derivedSignals: DerivedSignal[],
  ): TriggerResult[] {
    const results: TriggerResult[] = [];
    const text = msg.text ?? "";

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      try {
        const result = rule.evaluate(text, msg, derivedSignals);
        if (!result) continue;

        results.push(result);

        // Execute the action
        switch (result.action) {
          case "create_intent":
            if (this.intentStore) {
              this.intentStore.addIntent({
                sessionId: "",
                channelId: msg.channelId,
                chatId: msg.chatId,
                senderId: msg.senderId,
                what: result.payload["what"] as string,
                why: result.payload["why"] as string | undefined,
                confidence: (result.payload["confidence"] as number) ?? 0.8,
                executeAt: (result.payload["executeAt"] as number) ?? Date.now() + 86_400_000,
              });
              this.logger.info(
                { ruleId: rule.id, what: result.payload["what"] },
                "Trigger created intent",
              );
            }
            break;

          case "flag_for_prompt":
            // Flags are collected and injected into the prompt by the caller
            this.logger.info(
              { ruleId: rule.id, flag: result.payload["flag"] },
              "Trigger flagged for prompt",
            );
            break;

          case "update_signal":
            if (result.payload["signalType"] && result.payload["value"]) {
              this.intelligenceStore.writeDerivedSignal({
                senderId: msg.senderId,
                channelId: msg.channelId,
                signalType: result.payload["signalType"] as string,
                value: result.payload["value"] as string,
                confidence: (result.payload["confidence"] as number) ?? 0.7,
              });
            }
            break;
        }

        // Emit to bus
        this.bus.emit({ type: "trigger_fired", senderId: msg.senderId, result });
      } catch (err) {
        this.logger.error({ err, ruleId: rule.id }, "Trigger rule evaluation failed");
      }
    }

    return results;
  }
}
