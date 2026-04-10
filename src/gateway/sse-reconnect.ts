import type { Logger } from "../logging/logger.js";

export const SSE_RECONNECT_DELAY_MS = 5_000;
export const SSE_MAX_RECONNECT_DELAY_MS = 30_000;

export interface SSEReconnectDeps {
  bridge: {
    subscribeEvents(
      handler: (event: unknown) => void,
      signal: AbortSignal,
    ): Promise<void>;
  };
  eventHandler: { handleEvent(event: unknown): void };
  logger: Logger;
  signal: AbortSignal;
}

export function createSSEReconnect(deps: SSEReconnectDeps): () => Promise<void> {
  let sseReconnectDelay = SSE_RECONNECT_DELAY_MS;

  const wireSSE = async (): Promise<void> => {
    if (deps.signal.aborted) return;

    try {
      sseReconnectDelay = SSE_RECONNECT_DELAY_MS;
      await deps.bridge.subscribeEvents((event) => {
        deps.eventHandler.handleEvent(event);
      }, deps.signal);
      deps.logger.info("OpenCode SSE subscription ended");
    } catch (err) {
      if (deps.signal.aborted) return;

      deps.logger.warn(
        { err, nextRetryMs: sseReconnectDelay },
        `SSE subscription dropped — reconnecting in ${sseReconnectDelay}ms`,
      );

      const delay = sseReconnectDelay;
      sseReconnectDelay = Math.min(
        sseReconnectDelay * 2,
        SSE_MAX_RECONNECT_DELAY_MS,
      );

      setTimeout(() => {
        if (deps.signal.aborted) return;
        void wireSSE();
      }, delay);
    }
  };

  return wireSSE;
}
