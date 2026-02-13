import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelEvents,
  SendTextParams,
  SendMediaParams,
} from "../../src/channels/adapter.js";
import { TypedEventEmitter } from "../../src/utils/typed-emitter.js";
import type { ChannelAccountConfig } from "../../src/config/types.js";

export interface MockCall {
  method: string;
  args: unknown[];
}

export class MockAdapter implements ChannelAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ChannelCapabilities;
  readonly events = new TypedEventEmitter<ChannelEvents>();
  readonly calls: MockCall[] = [];

  private messageCounter = 0;

  constructor(id = "mock", label = "Mock Channel") {
    this.id = id;
    this.label = label;
    this.capabilities = {
      text: true,
      image: false,
      video: false,
      audio: false,
      document: false,
      reaction: false,
      typing: true,
      edit: false,
      delete: false,
      reply: true,
      thread: false,
      maxTextLength: 4096,
    };
  }

  async start(_config: ChannelAccountConfig, _signal: AbortSignal): Promise<void> {
    this.calls.push({ method: "start", args: [] });
    this.events.emit("connected");
  }

  async stop(): Promise<void> {
    this.calls.push({ method: "stop", args: [] });
    this.events.emit("disconnected", "stopped");
  }

  async sendText(params: SendTextParams): Promise<{ messageId: string }> {
    this.calls.push({ method: "sendText", args: [params] });
    return { messageId: `mock-${++this.messageCounter}` };
  }

  async sendMedia(params: SendMediaParams): Promise<{ messageId: string }> {
    this.calls.push({ method: "sendMedia", args: [params] });
    return { messageId: `mock-${++this.messageCounter}` };
  }

  async sendTyping(params: { to: string }): Promise<void> {
    this.calls.push({ method: "sendTyping", args: [params] });
  }
}
