import { Bot, GrammyError } from "grammy";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelEvents,
  SendTextParams,
  SendMediaParams,
} from "../adapter.js";import type { MessageCache } from "../message-cache.js";
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
  inlineButtons: true,
  maxTextLength: 4096,
};

/**
 * Performs a preflight check to detect concurrent iris-gateway instances.
 *
 * Calls getUpdates with timeout=0 (non-blocking) before starting the polling
 * loop. If another instance is already polling, Telegram returns a 409 Conflict.
 * We catch this and throw a structured error so the process can exit early with
 * a clear message, instead of logging GrammyErrors indefinitely.
 *
 * Timeout=0 means: return immediately with any pending updates (or empty array).
 * It does NOT block for 30 seconds like the normal polling loop.
 */
async function assertNoConcurrentPoller(bot: Bot): Promise<void> {
  try {
    await bot.api.getUpdates({ limit: 1, timeout: 0 });
  } catch (err: unknown) {
    if (err instanceof GrammyError && err.error_code === 409) {
      // Distinguish between two 409 scenarios:
      // 1. Another getUpdates poller is running → description contains "terminated by other"
      // 2. A webhook is set → description contains "Webhook is active"
      const description = err.description ?? "";
      if (description.toLowerCase().includes("webhook")) {
        throw new Error(
          "Telegram conflict (409): a webhook is currently active for this bot. " +
          "Remove the webhook before using long-polling mode. " +
          "Run: curl 'https://api.telegram.org/bot<TOKEN>/deleteWebhook'"
        );
      }
      throw new Error(
        "Telegram conflict detected (409): another iris-gateway instance is already polling this bot. " +
        "Stop the other instance before starting a new one. " +
        "Run: pkill -f 'iris-gateway' or 'node.*dist/index.js'"
      );
    }
    // Any other error (network, auth): re-throw as-is
    throw err;
  }
}

export class TelegramAdapter implements ChannelAdapter {
  readonly id = "telegram";
  readonly label = "Telegram";
  readonly capabilities = CAPABILITIES;
  readonly events = new TypedEventEmitter<ChannelEvents>();

  private _isConnected = false;
  /**
   * True once bot.start() has been fired. Reflects *intent* to connect, not
   * confirmed reachability (grammY long-polling gives no ready callback).
   * Renamed alias: isPolling — prefer isConnected for interface compat.
   */
  get isConnected(): boolean { return this._isConnected; }
  /** Alias that communicates the true semantics: polling loop was started. */
  get isPolling(): boolean { return this._isConnected; }

  private bot: Bot | null = null;
  private botUserId: string | null = null;
  private messageCache: MessageCache | null = null;
  private permissionApprover: ((sessionId: string, permissionId: string, response: "once" | "reject") => Promise<void>) | null = null;

  setMessageCache(cache: MessageCache): void {
    this.messageCache = cache;
  }

  setPermissionApprover(fn: (sessionId: string, permissionId: string, response: "once" | "reject") => Promise<void>): void {
    this.permissionApprover = fn;
  }

  async start(config: ChannelAccountConfig, signal: AbortSignal, opts?: { skipConflictCheck?: boolean }): Promise<void> {
    if (!config.token) throw new Error("Telegram bot token is required");

    this.bot = new Bot(config.token);

    this.bot.on("message", (ctx) => {
      // Filter own messages to prevent infinite loops
      if (this.botUserId && String(ctx.from?.id) === this.botUserId) return;
      const msg = normalizeTelegramMessage(ctx);
      if (msg) this.events.emit("message", msg);
    });

    // Handle inline button callbacks for permission approval (perm:once|always|reject:<sessionId>:<permId>)
    this.bot.on("callback_query:data", async (ctx) => {
      const data = ctx.callbackQuery.data ?? "";
      const permMatch = data.match(/^perm:(once|always|reject):([^:]+):(.+)$/);
      if (permMatch) {
        const [, action, sessionId, permissionId] = permMatch;
        const response = action === "reject" ? "reject" : "once";
        if (this.permissionApprover) {
          try {
            await this.permissionApprover(sessionId, permissionId, response as "once" | "reject");
            await ctx.answerCallbackQuery({ text: action === "reject" ? "Permission denied." : "Permission granted." });
            await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
          } catch (err) {
            await ctx.answerCallbackQuery({ text: "Failed to process permission." });
          }
        } else {
          await ctx.answerCallbackQuery({ text: "No permission handler registered." });
        }
        return;
      }
      await ctx.answerCallbackQuery();
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

    // Preflight: detect concurrent instances before entering the polling loop.
    // Throws with a human-readable message if another poller is active (409 conflict).
    // Skip for outbound-only callers (e.g. `iris send telegram`) that don't enter the polling loop.
    if (!opts?.skipConflictCheck) {
      await assertNoConcurrentPoller(this.bot);
    }

    // bot.start() never resolves (runs polling loop forever), so fire-and-forget
    this.bot.start({ drop_pending_updates: true }).catch((err) => {
      this.events.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
    // NOTE: _isConnected reflects intent to connect, not confirmed reachability.
    // grammY provides no ready/connected callback in long-polling mode — bot.start()
    // runs the polling loop forever and never resolves. We set this flag after
    // assertNoConcurrentPoller() confirmed the bot token is valid and no 409 conflict
    // exists. This is the strongest signal available without blocking the start path.
    // ChannelAdapter.isConnected documents this semantic explicitly.
    this._isConnected = true;
    this.events.emit("connected");
  }

  async stop(): Promise<void> {
    this.bot?.stop();
    this.bot = null;
    this._isConnected = false;
    this.events.emit("disconnected", "stopped");
  }

  async sendText(params: SendTextParams): Promise<{ messageId: string }> {
    if (!this.bot) throw new Error("Telegram bot not started");
    const result = await send.sendText(this.bot, params.to, params.text, params.replyToId, params.buttons);
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
