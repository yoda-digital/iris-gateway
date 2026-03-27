import { metrics } from "../gateway/metrics.js";

/**
 * Centralises metric emissions for MessageRouter.
 * Extracted from message-router.ts to keep that file under 250 lines.
 */
export function recordReceived(channel: string): void {
  metrics.messagesReceived.inc({ channel });
}

export function recordSent(channel: string): void {
  metrics.messagesSent.inc({ channel });
}

export function recordError(channel: string, errorType: string): void {
  metrics.messagesErrors.inc({ channel, error_type: errorType });
}

export function recordLatency(channel: string, elapsedMs: number): void {
  metrics.messageProcessingLatency.observe(
    { channel, stage: "full" },
    elapsedMs / 1000,
  );
}
