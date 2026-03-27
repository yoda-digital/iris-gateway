import type { VaultDB } from "../vault/db.js";
import type { SignalStore } from "../onboarding/signals.js";
import type { IntentStore } from "../proactive/store.js";
import type { HeartbeatStore } from "../heartbeat/store.js";
import type { Logger } from "../logging/logger.js";
import type { TitleGeneratorFn } from "../intelligence/arcs/detector.js";
import { initIntelligence } from "./intelligence-wiring.js";
import type { IntelligenceComponents } from "./intelligence-wiring.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";

export function bootstrapIntelligence(
  bridge: OpenCodeBridge,
  vaultDb: VaultDB,
  signalStore: SignalStore | null,
  intentStore: IntentStore | null,
  heartbeatStore: HeartbeatStore | null,
  logger: Logger,
  userLanguage?: string,
): IntelligenceComponents {
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
      bridge.deleteSession(session.id).catch((err) => {
        logger.warn({ err, sessionId: session.id }, "Failed to delete title generation session");
      });
    }
  };

  return initIntelligence(vaultDb, signalStore, intentStore, heartbeatStore, logger, titleGenerator, userLanguage);
}
