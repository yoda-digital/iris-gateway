import type { TypedEventEmitter } from "../utils/typed-emitter.js";
import type { ChannelAccountConfig } from "../config/types.js";
import type { InboundMessage } from "../types/message.js";
export type { InboundMessage, InboundMedia } from "../types/message.js";

export interface ChannelCapabilities {
  readonly text: boolean;
  readonly image: boolean;
  readonly video: boolean;
  readonly audio: boolean;
  readonly document: boolean;
  readonly reaction: boolean;
  readonly typing: boolean;
  readonly edit: boolean;
  readonly delete: boolean;
  readonly reply: boolean;
  readonly thread: boolean;
  readonly inlineButtons: boolean;
  readonly maxTextLength: number;
}



export interface InlineButton {
  readonly text: string;
  readonly callbackData: string;
}

export interface SendTextParams {
  readonly to: string;
  readonly text: string;
  readonly replyToId?: string;
  readonly buttons?: readonly (readonly InlineButton[])[];
}

export interface SendMediaParams {
  readonly to: string;
  readonly type: "image" | "video" | "audio" | "document";
  readonly source: string | Buffer;
  readonly mimeType: string;
  readonly filename?: string;
  readonly caption?: string;
}

export interface ChannelEvents {
  message: (msg: InboundMessage) => void;
  error: (err: Error) => void;
  connected: () => void;
  disconnected: (reason?: string) => void;
}

export interface ChannelAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ChannelCapabilities;
  readonly events: TypedEventEmitter<ChannelEvents>;
  /**
   * Returns true if the adapter's polling/connection loop has been started
   * (i.e., `start()` was called successfully). This reflects *intent*, not
   * confirmed reachability. For a real connectivity check, use `checkHealth()`
   * if available, or inspect the "connected" event.
   */
  readonly isConnected: boolean;

  start(config: ChannelAccountConfig, signal: AbortSignal, opts?: Record<string, unknown>): Promise<void>;
  stop(): Promise<void>;

  sendText(params: SendTextParams): Promise<{ messageId: string }>;
  sendMedia?(params: SendMediaParams): Promise<{ messageId: string }>;
  sendTyping?(params: { to: string }): Promise<void>;
  sendReaction?(params: { messageId: string; emoji: string; chatId?: string }): Promise<void>;
  editMessage?(params: { messageId: string; text: string; chatId?: string }): Promise<void>;
  deleteMessage?(params: { messageId: string; chatId?: string }): Promise<void>;
}
