import type { HookMap, HookHandler } from "./types.js";

export class HookBus {
  private handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

  on<K extends keyof HookMap>(event: K, handler: HookHandler<K>): () => void {
    const list = this.handlers.get(event as string) ?? [];
    list.push(handler as (...args: unknown[]) => unknown);
    this.handlers.set(event as string, list);
    return () => {
      const idx = list.indexOf(handler as (...args: unknown[]) => unknown);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  async emit<K extends keyof HookMap>(event: K, data: HookMap[K]): Promise<void> {
    const list = this.handlers.get(event as string) ?? [];
    for (const handler of list) {
      try {
        await handler(data);
      } catch {
        // Hooks must not crash the system
      }
    }
  }
}
