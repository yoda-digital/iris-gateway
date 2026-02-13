import type { OpenCodeEvent, Part } from "./opencode-client.js";
import { TypedEventEmitter } from "../utils/typed-emitter.js";

export interface EventHandlerEvents {
  response: (sessionId: string, text: string) => void;
  error: (sessionId: string, error: unknown) => void;
  toolCall: (sessionId: string, toolName: string, input: unknown) => void;
}

const ACCUMULATOR_TTL_MS = 5 * 60_000; // 5 minutes
const ACCUMULATOR_CLEANUP_INTERVAL_MS = 60_000; // 1 minute

interface EventProperties {
  type?: string;
  properties?: Record<string, unknown>;
}

function getProps(event: OpenCodeEvent): Record<string, unknown> | undefined {
  return (event as EventProperties).properties ?? undefined;
}

function getEventType(event: OpenCodeEvent): string | undefined {
  return typeof (event as EventProperties).type === "string"
    ? (event as EventProperties).type
    : undefined;
}

function isTextPart(part: unknown): part is { type: "text"; text: string; sessionID: string } {
  if (!part || typeof part !== "object") return false;
  const p = part as Record<string, unknown>;
  return p.type === "text" && typeof p.text === "string" && typeof p.sessionID === "string";
}

function isReasoningPart(part: unknown): part is { type: "reasoning"; text: string; sessionID: string } {
  if (!part || typeof part !== "object") return false;
  const p = part as Record<string, unknown>;
  return p.type === "reasoning" && typeof p.text === "string" && typeof p.sessionID === "string";
}

function isToolPart(part: unknown): part is { type: "tool"; tool: string; sessionID: string; metadata?: unknown } {
  if (!part || typeof part !== "object") return false;
  const p = part as Record<string, unknown>;
  return p.type === "tool" && typeof p.tool === "string" && typeof p.sessionID === "string";
}

export class EventHandler {
  readonly events = new TypedEventEmitter<EventHandlerEvents>();
  private readonly accumulator = new Map<string, { textChunks: string[]; reasoningChunks: string[]; updatedAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.pruneStale(), ACCUMULATOR_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.accumulator.clear();
  }

  handleEvent(event: OpenCodeEvent): void {
    const eventType = getEventType(event);
    if (!eventType) return;

    const props = getProps(event);
    if (!props) return;

    switch (eventType) {
      case "message.part.updated": {
        const part = props.part as Part | undefined;
        if (!part) break;
        const delta = typeof props.delta === "string" ? props.delta : undefined;

        if (isTextPart(part)) {
          const now = Date.now();
          const entry = this.accumulator.get(part.sessionID) ?? { textChunks: [], reasoningChunks: [], updatedAt: now };
          if (delta) {
            entry.textChunks.push(delta);
          } else {
            entry.textChunks.length = 0;
            entry.textChunks.push(part.text);
          }
          entry.updatedAt = now;
          this.accumulator.set(part.sessionID, entry);
        }

        if (isReasoningPart(part)) {
          const now = Date.now();
          const entry = this.accumulator.get(part.sessionID) ?? { textChunks: [], reasoningChunks: [], updatedAt: now };
          if (delta) {
            entry.reasoningChunks.push(delta);
          } else {
            entry.reasoningChunks.length = 0;
            entry.reasoningChunks.push(part.text);
          }
          entry.updatedAt = now;
          this.accumulator.set(part.sessionID, entry);
        }

        if (isToolPart(part)) {
          this.events.emit("toolCall", part.sessionID, part.tool, part.metadata);
        }
        break;
      }

      case "session.idle": {
        const sessionId = typeof props.sessionID === "string" ? props.sessionID : undefined;
        if (!sessionId) break;
        const entry = this.accumulator.get(sessionId);
        if (entry) {
          // Prefer text parts; fall back to reasoning if model only produced reasoning
          const text = entry.textChunks.length > 0
            ? entry.textChunks.join("")
            : entry.reasoningChunks.length > 0
              ? entry.reasoningChunks.join("")
              : "";
          if (text) {
            this.events.emit("response", sessionId, text);
          }
          this.accumulator.delete(sessionId);
        }
        break;
      }

      case "session.error": {
        const sessionId = typeof props.sessionID === "string" ? props.sessionID : undefined;
        if (!sessionId) break;
        this.events.emit("error", sessionId, props.error);
        this.accumulator.delete(sessionId);
        break;
      }
    }
  }

  private pruneStale(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.accumulator) {
      if (now - entry.updatedAt > ACCUMULATOR_TTL_MS) {
        this.accumulator.delete(sessionId);
      }
    }
  }
}
