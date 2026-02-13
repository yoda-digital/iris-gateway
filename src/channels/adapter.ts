import type { TypedEventEmitter } from "../utils/typed-emitter.js";
import type { ChannelAccountConfig } from "../config/types.js";

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
  readonly maxTextLength: number;
}

export interface InboundMessage {
  readonly id: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly chatId: string;
  readonly chatType: "dm" | "group";
  readonly text?: string;
  readonly media?: InboundMedia[];
  readonly replyToId?: string;
  readonly timestamp: number;
  readonly raw: unknown;
}

export interface InboundMedia {
  readonly type: "image" | "video" | "audio" | "document";
  readonly mimeType: string;
  readonly url?: string;
  readonly buffer?: Buffer;
  readonly filename?: string;
  readonly size?: number;
  readonly caption?: string;
}

export interface SendTextParams {
  readonly to: string;
  readonly text: string;
  readonly replyToId?: string;
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

  start(config: ChannelAccountConfig, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;

  sendText(params: SendTextParams): Promise<{ messageId: string }>;
  sendMedia?(params: SendMediaParams): Promise<{ messageId: string }>;
  sendTyping?(params: { to: string }): Promise<void>;
  sendReaction?(params: { messageId: string; emoji: string; chatId?: string }): Promise<void>;
  editMessage?(params: { messageId: string; text: string; chatId?: string }): Promise<void>;
  deleteMessage?(params: { messageId: string; chatId?: string }): Promise<void>;
}
