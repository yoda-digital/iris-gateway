import { EventEmitter } from "node:events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => void;

export class TypedEventEmitter<
  T extends { [K in keyof T]: Fn },
> {
  private readonly emitter = new EventEmitter();

  on<K extends string & keyof T>(event: K, listener: T[K]): this {
    this.emitter.on(event, listener as Fn);
    return this;
  }

  off<K extends string & keyof T>(event: K, listener: T[K]): this {
    this.emitter.off(event, listener as Fn);
    return this;
  }

  once<K extends string & keyof T>(event: K, listener: T[K]): this {
    this.emitter.once(event, listener as Fn);
    return this;
  }

  emit<K extends string & keyof T>(
    event: K,
    ...args: Parameters<T[K]>
  ): boolean {
    return this.emitter.emit(event, ...args);
  }

  removeAllListeners<K extends string & keyof T>(event?: K): this {
    this.emitter.removeAllListeners(event);
    return this;
  }

  listenerCount<K extends string & keyof T>(event: K): number {
    return this.emitter.listenerCount(event);
  }
}
