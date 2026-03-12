import type { CanvasComponent } from "./components.js";

export interface CanvasMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly timestamp: number;
}

export class CanvasSession {
  readonly id: string;
  private components: CanvasComponent[] = [];
  private messages: CanvasMessage[] = [];
  private clients = new Set<(data: string) => void>();

  constructor(id: string) {
    this.id = id;
  }

  getComponents(): CanvasComponent[] {
    return [...this.components];
  }

  getMessages(): CanvasMessage[] {
    return [...this.messages];
  }

  addComponent(component: CanvasComponent): void {
    const idx = this.components.findIndex((c) => c.id === component.id);
    if (idx >= 0) {
      this.components[idx] = component;
    } else {
      this.components.push(component);
    }
    this.broadcast({ type: "component.update", component });
  }

  removeComponent(id: string): boolean {
    const idx = this.components.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    this.components.splice(idx, 1);
    this.broadcast({ type: "component.remove", id });
    return true;
  }

  clearComponents(): void {
    this.components = [];
    this.broadcast({ type: "component.clear" });
  }

  addMessage(msg: CanvasMessage): void {
    this.messages.push(msg);
    this.broadcast({ type: "message", message: msg });
  }

  addClient(send: (data: string) => void): () => void {
    this.clients.add(send);
    // Send current state to new client
    send(JSON.stringify({
      type: "state",
      components: this.components,
      messages: this.messages,
    }));
    return () => { this.clients.delete(send); };
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private broadcast(data: unknown): void {
    const payload = JSON.stringify(data);
    for (const send of this.clients) {
      try { send(payload); } catch { /* client disconnected */ }
    }
  }
}
