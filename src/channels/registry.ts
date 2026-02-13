import type { ChannelAdapter } from "./adapter.js";

export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Channel adapter already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ChannelAdapter | undefined {
    return this.adapters.get(id);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  list(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }
}
