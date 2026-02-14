import { EventEmitter } from "node:events";
import type { IntelligenceEvent } from "./types.js";

type EventType = IntelligenceEvent["type"];
type EventOfType<T extends EventType> = Extract<IntelligenceEvent, { type: T }>;
type Handler<T extends EventType> = (event: EventOfType<T>) => void;

/**
 * Typed, synchronous, in-process event bus for the intelligence layer.
 * Not a message queue — events are delivered synchronously within
 * the same tick. Keeps the intelligence pipeline <5ms per message.
 */
export class IntelligenceBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Increase limit — we may have many listeners across subsystems
    this.emitter.setMaxListeners(50);
  }

  emit<T extends EventType>(event: EventOfType<T>): void {
    this.emitter.emit(event.type, event);
  }

  on<T extends EventType>(type: T, handler: Handler<T>): void {
    this.emitter.on(type, handler as (...args: unknown[]) => void);
  }

  off<T extends EventType>(type: T, handler: Handler<T>): void {
    this.emitter.off(type, handler as (...args: unknown[]) => void);
  }

  dispose(): void {
    this.emitter.removeAllListeners();
  }
}
