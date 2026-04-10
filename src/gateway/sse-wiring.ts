import type { OpenCodeBridge } from "../bridge/opencode-client.js";
import type { MessageRouter } from "../bridge/message-router.js";
import type { Logger } from "../logging/logger.js";

export const SSE_RECONNECT_DELAY_MS = 5_000;
export const SSE_MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Subscribe to OpenCode SSE events with exponential backoff reconnect.
 */
export function wireSSEReconnect(
  bridge: OpenCodeBridge,
  router: MessageRouter,
  logger: Logger,
  signal: AbortSignal,
): void {
  let reconnectDelay = SSE_RECONNECT_DELAY_MS;

  const connect = async (): Promise<void> => {
    if (signal.aborted) return;

    try {
      reconnectDelay = SSE_RECONNECT_DELAY_MS;
      await bridge.subscribeEvents((event) => {
        router.getEventHandler().handleEvent(event);
      }, signal);
      logger.info("OpenCode SSE subscription ended");
    } catch (err) {
      if (signal.aborted) return;

      logger.warn(
        { err, nextRetryMs: reconnectDelay },
        `SSE subscription dropped — reconnecting in ${reconnectDelay}ms`,
      );

      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, SSE_MAX_RECONNECT_DELAY_MS);
      setTimeout(() => {
        if (signal.aborted) return;
        void connect();
      }, delay);
    }
  };

  void connect();
}
