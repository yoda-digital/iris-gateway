import type { Client } from "discord.js";
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
import { createDiscordClient } from "./client.js";
import { normalizeDiscordMessage } from "./normalize.js";
import * as send from "./send.js";

const CAPABILITIES: ChannelCapabilities = {
  text: true,
  image: true,
  video: true,
  audio: false,
  document: true,
  reaction: true,
  typing: true,
  edit: true,
  delete: true,
  reply: true,
  thread: false,
  maxTextLength: 2000,
};

export class DiscordAdapter implements ChannelAdapter {
  readonly id = "discord";
  readonly label = "Discord";
  readonly capabilities = CAPABILITIES;
  readonly events = new TypedEventEmitter<ChannelEvents>();

  private client: Client | null = null;
  private messageCache: MessageCache | null = null;

  setMessageCache(cache: MessageCache): void {
    this.messageCache = cache;
  }

  async start(
    config: ChannelAccountConfig,
    signal: AbortSignal,
  ): Promise<void> {
    if (!config.token) throw new Error("Discord bot token is required");

    this.client = createDiscordClient();

    this.client.on("ready", () => {
      this.events.emit("connected");
    });

    this.client.on("messageCreate", (discordMsg) => {
      const msg = normalizeDiscordMessage(discordMsg);
      if (msg) this.events.emit("message", msg);
    });

    this.client.on("error", (err) => {
      this.events.emit("error", err);
    });

    signal.addEventListener("abort", () => {
      this.client?.destroy();
    });

    await this.client.login(config.token);
  }

  async stop(): Promise<void> {
    this.client?.destroy();
    this.client = null;
    this.events.emit("disconnected", "stopped");
  }

  async sendText(params: SendTextParams): Promise<{ messageId: string }> {
    if (!this.client) throw new Error("Discord client not started");
    const result = await send.sendText(
      this.client,
      params.to,
      params.text,
      params.replyToId,
    );
    this.messageCache?.set(result.messageId, {
      channelId: this.id,
      chatId: params.to,
      timestamp: Date.now(),
    });
    return result;
  }

  async sendTyping(params: { to: string }): Promise<void> {
    if (!this.client) throw new Error("Discord client not started");
    await send.sendTyping(this.client, params.to);
  }

  async sendMedia(params: SendMediaParams): Promise<{ messageId: string }> {
    if (!this.client) throw new Error("Discord client not started");
    const result = await send.sendMedia(this.client, params);
    this.messageCache?.set(result.messageId, {
      channelId: this.id,
      chatId: params.to,
      timestamp: Date.now(),
    });
    return result;
  }

  async editMessage(params: { messageId: string; text: string; chatId?: string }): Promise<void> {
    if (!this.client) throw new Error("Discord client not started");
    const ctx = this.messageCache?.get(params.messageId);
    const channelId = params.chatId ?? ctx?.chatId;
    if (!channelId) throw new Error("Cannot resolve channelId for edit");
    await send.editMessage(this.client, channelId, params.messageId, params.text);
  }

  async deleteMessage(params: { messageId: string; chatId?: string }): Promise<void> {
    if (!this.client) throw new Error("Discord client not started");
    const ctx = this.messageCache?.get(params.messageId);
    const channelId = params.chatId ?? ctx?.chatId;
    if (!channelId) throw new Error("Cannot resolve channelId for delete");
    await send.deleteMessage(this.client, channelId, params.messageId);
  }

  async sendReaction(params: { messageId: string; emoji: string; chatId?: string }): Promise<void> {
    if (!this.client) throw new Error("Discord client not started");
    const ctx = this.messageCache?.get(params.messageId);
    const channelId = params.chatId ?? ctx?.chatId;
    if (!channelId) throw new Error("Cannot resolve channelId for reaction");
    await send.sendReaction(this.client, channelId, params.messageId, params.emoji);
  }
}
