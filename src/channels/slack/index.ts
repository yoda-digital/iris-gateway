import { App } from "@slack/bolt";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelEvents,
  SendTextParams,
  SendMediaParams,
} from "../adapter.js";
import type { MessageCache } from "../message-cache.js";
import { TypedEventEmitter } from "../../utils/typed-emitter.js";
import type { ChannelAccountConfig } from "../../config/types.js";
import {
  normalizeSlackMessage,
  type SlackMessageEvent,
  type UserDisplayNameCache,
} from "./normalize.js";
import * as send from "./send.js";

const CAPABILITIES: ChannelCapabilities = {
  text: true,
  image: true,
  video: false,
  audio: false,
  document: true,
  reaction: true,
  typing: false,
  edit: true,
  delete: true,
  reply: true,
  thread: false,
  maxTextLength: 40000,
};

export class SlackAdapter implements ChannelAdapter {
  readonly id = "slack";
  readonly label = "Slack";
  readonly capabilities = CAPABILITIES;
  readonly events = new TypedEventEmitter<ChannelEvents>();

  private _isConnected = false;
  get isConnected(): boolean { return this._isConnected; }

  private app: App | null = null;
  private messageCache: MessageCache | null = null;
  /** Cache for Slack user display names to avoid repeated API calls */
  private displayNameCache: UserDisplayNameCache = new Map();

  setMessageCache(cache: MessageCache): void {
    this.messageCache = cache;
  }

  async start(
    config: ChannelAccountConfig,
    signal: AbortSignal,
  ): Promise<void> {
    if (!config.appToken || !config.botToken) {
      throw new Error("Slack appToken and botToken are required");
    }

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
    });

    // Pass client and cache to normalizeSlackMessage for display name resolution
    this.app.message(async ({ message, client }) => {
      const msg = await normalizeSlackMessage(
        message as SlackMessageEvent,
        client,
        this.displayNameCache,
      );
      if (msg) this.events.emit("message", msg);
    });

    this.app.error(async (error) => {
      this.events.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
    });

    signal.addEventListener("abort", () => {
      this.app?.stop().catch(() => {});
    });

    await this.app.start();
    this._isConnected = true;
    this.events.emit("connected");
  }

  async stop(): Promise<void> {
    await this.app?.stop();
    this.app = null;
    this._isConnected = false;
    // Clear the display name cache on stop
    this.displayNameCache.clear();
    this.events.emit("disconnected", "stopped");
  }

  async sendText(params: SendTextParams): Promise<{ messageId: string }> {
    if (!this.app) throw new Error("Slack app not started");
    const result = await send.sendText(this.app, params.to, params.text, params.replyToId);
    this.messageCache?.set(result.messageId, {
      channelId: this.id,
      chatId: params.to,
      timestamp: Date.now(),
    });
    return result;
  }

  async sendMedia(params: SendMediaParams): Promise<{ messageId: string }> {
    if (!this.app) throw new Error("Slack app not started");
    return send.sendMedia(this.app, params);
  }

  async editMessage(params: { messageId: string; text: string; chatId?: string }): Promise<void> {
    if (!this.app) throw new Error("Slack app not started");
    const ctx = this.messageCache?.get(params.messageId);
    const channel = params.chatId ?? ctx?.chatId;
    if (!channel) throw new Error("Cannot resolve channel for edit");
    await send.editMessage(this.app, channel, params.messageId, params.text);
  }

  async deleteMessage(params: { messageId: string; chatId?: string }): Promise<void> {
    if (!this.app) throw new Error("Slack app not started");
    const ctx = this.messageCache?.get(params.messageId);
    const channel = params.chatId ?? ctx?.chatId;
    if (!channel) throw new Error("Cannot resolve channel for delete");
    await send.deleteMessage(this.app, channel, params.messageId);
  }

  async sendReaction(params: { messageId: string; emoji: string; chatId?: string }): Promise<void> {
    if (!this.app) throw new Error("Slack app not started");
    const ctx = this.messageCache?.get(params.messageId);
    const channel = params.chatId ?? ctx?.chatId;
    if (!channel) throw new Error("Cannot resolve channel for reaction");
    await send.sendReaction(this.app, channel, params.messageId, params.emoji);
  }
}