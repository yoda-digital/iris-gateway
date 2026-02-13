import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelEvents,
  SendTextParams,
} from "../adapter.js";
import type { ChannelAccountConfig } from "../../config/types.js";
import { TypedEventEmitter } from "../../utils/typed-emitter.js";
import type { CanvasServer } from "../../canvas/server.js";

export class WebChatAdapter implements ChannelAdapter {
  readonly id = "webchat";
  readonly label = "Web Chat";
  readonly capabilities: ChannelCapabilities = {
    text: true,
    image: false,
    video: false,
    audio: false,
    document: false,
    reaction: false,
    typing: false,
    edit: false,
    delete: false,
    reply: false,
    thread: false,
    maxTextLength: 100_000,
  };
  readonly events = new TypedEventEmitter<ChannelEvents>();

  private canvasServer: CanvasServer | null = null;

  setCanvasServer(server: CanvasServer): void {
    this.canvasServer = server;
  }

  async start(_config: ChannelAccountConfig, _signal: AbortSignal): Promise<void> {
    this.events.emit("connected");
  }

  async stop(): Promise<void> {
    this.events.emit("disconnected", "stopped");
  }

  async sendText(params: SendTextParams): Promise<{ messageId: string }> {
    const messageId = `webchat-${Date.now()}`;
    if (this.canvasServer) {
      this.canvasServer.addAssistantMessage(params.to, params.text);
    }
    return { messageId };
  }
}
