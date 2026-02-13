import { Bot } from "grammy";
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
import { normalizeTelegramMessage } from "./normalize.js";
import * as send from "./send.js";

const CAPABILITIES: ChannelCapabilities = {
  text: true,
  image: true,
  video: true,
  audio: true,
  document: true,
  reaction: true,
  typing: true,
  edit: true,
  delete: true,
  reply: true,
  thread: false,
  maxTextLength: 4096,
};

export class TelegramAdapter implements ChannelAdapter {
  readonly id = "telegram";
  readonly label = "Telegram";
  readonly capabilities = CAPABILITIES;
  readonly events = new TypedEventEmitter<ChannelEvents>();

  private bot: Bot | null = null;
  private botUserId: string | null = null;
  private messageCache: MessageCache | null = null;

  setMessageCache(cache: MessageCache): void {
    this.messageCache = cache;
  }

  async start(config: ChannelAccountConfig, signal: AbortSignal): Promise<void> {
    if (!config.token) throw new Error("Telegram bot token is required");

    this.bot = new Bot(config.token);

    this.bot.on("message", (ctx) => {
      // Filter own messages to prevent infinite loops
      if (this.botUserId && String(ctx.from?.id) === this.botUserId) return;
      const msg = normalizeTelegramMessage(ctx);
      if (msg) this.events.emit("message", msg);
    });

    this.bot.catch((err) => {
      this.events.emit("error", err.error instanceof Error ? err.error : new Error(String(err.error)));
    });

    signal.addEventListener("abort", () => {
      this.bot?.stop();
    });

    // Get bot info before starting to know our own ID
    const botInfo = await this.bot.api.getMe();
    this.botUserId = String(botInfo.id);

    // bot.start() never resolves (runs polling loop forever), so fire-and-forget
    this.bot.start({ drop_pending_updates: true }).catch((err) => {
      this.events.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
    this.events.emit("connected");
  }

  async stop(): Promise<void> {
    this.bot?.stop();
    this.bot = null;
    this.events.emit("disconnected", "stopped");
  }

  async sendText(params: SendTextParams): Promise<{ messageId: string }> {
    if (!this.bot) throw new Error("Telegram bot not started");
    const result = await send.sendText(this.bot, params.to, params.text, params.replyToId);
    this.messageCache?.set(result.messageId, {
      channelId: this.id,
      chatId: params.to,
      timestamp: Date.now(),
    });
    return result;
  }

  async sendTyping(params: { to: string }): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not started");
    await send.sendTyping(this.bot, params.to);
  }

  async sendMedia(params: SendMediaParams): Promise<{ messageId: string }> {
    if (!this.bot) throw new Error("Telegram bot not started");
    const result = await send.sendMedia(this.bot, params);
    this.messageCache?.set(result.messageId, {
      channelId: this.id,
      chatId: params.to,
      timestamp: Date.now(),
    });
    return result;
  }

  async editMessage(params: { messageId: string; text: string; chatId?: string }): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not started");
    const ctx = this.messageCache?.get(params.messageId);
    const chatId = params.chatId ?? ctx?.chatId;
    if (!chatId) throw new Error("Cannot resolve chatId for edit");
    await send.editMessage(this.bot, chatId, params.messageId, params.text);
  }

  async deleteMessage(params: { messageId: string; chatId?: string }): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not started");
    const ctx = this.messageCache?.get(params.messageId);
    const chatId = params.chatId ?? ctx?.chatId;
    if (!chatId) throw new Error("Cannot resolve chatId for delete");
    await send.deleteMessage(this.bot, chatId, params.messageId);
  }

  async sendReaction(params: { messageId: string; emoji: string; chatId?: string }): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not started");
    const ctx = this.messageCache?.get(params.messageId);
    const chatId = params.chatId ?? ctx?.chatId;
    if (!chatId) throw new Error("Cannot resolve chatId for reaction");
    await send.sendReaction(this.bot, chatId, params.messageId, params.emoji);
  }
}
