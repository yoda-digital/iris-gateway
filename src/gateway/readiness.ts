import type { OpenCodeBridge } from "../bridge/opencode-client.js";
import type { Logger } from "../logging/logger.js";

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;

/**
 * Polls OpenCode bridge until it reports healthy or timeout is reached.
 * Applies an optional grace period after the health check passes.
 */
export async function waitForOpenCodeReady(bridge: OpenCodeBridge, logger: Logger): Promise<void> {
  const readyStart = Date.now();
  let warmupDone = false;
  while (Date.now() - readyStart < READY_TIMEOUT_MS) {
    try {
      const healthy = await bridge.checkHealth();
      if (healthy) {
        // Intentional: `!== undefined` check (not `||`) means OPENCODE_WARMUP_GRACE_MS=0
        // genuinely skips the grace period. The old `|| 1000` coercion treated 0 as
        // falsy and fell back to 1000ms, which was surprising.
        const gracePeriodMs =
          process.env.OPENCODE_WARMUP_GRACE_MS !== undefined
            ? Number(process.env.OPENCODE_WARMUP_GRACE_MS)
            : 1000;
        await new Promise((resolve) => setTimeout(resolve, gracePeriodMs));
        warmupDone = true;
        logger.info("OpenCode ready (health check passed)");
        break;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  if (!warmupDone) {
    logger.warn("OpenCode warmup timed out — providers may not be ready");
  }
}
