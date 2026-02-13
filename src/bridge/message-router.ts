import type { InboundMessage } from "../channels/adapter.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { SecurityGate, SecurityCheckResult } from "../security/dm-policy.js";
import type { Logger } from "../logging/logger.js";
import type { ChannelAccountConfig } from "../config/types.js";
import { chunkText, PLATFORM_LIMITS } from "../utils/text-chunker.js";
import { shouldProcessGroupMessage, stripBotMention } from "../channels/mention-gating.js";
import type { OpenCodeBridge } from "./opencode-client.js";
import type { SessionMap } from "./session-map.js";
import { EventHandler } from "./event-handler.js";
import { MessageQueue } from "./message-queue.js";
import { StreamCoalescer } from "./stream-coalescer.js";
import type { TemplateEngine } from "../auto-reply/engine.js";

const PENDING_TTL_MS = 5 * 60_000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

interface PendingResponse {
  channelId: string;
  chatId: string;
  replyToId?: string;
  createdAt: number;
}

export class MessageRouter {
  private readonly eventHandler: EventHandler;
  private readonly pendingResponses = new Map<string, PendingResponse>();
  private readonly activeCoalescers = new Map<string, StreamCoalescer>();
  private readonly outboundQueue: MessageQueue;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly bridge: OpenCodeBridge,
    private readonly sessionMap: SessionMap,
    private readonly securityGate: SecurityGate,
    private readonly registry: ChannelRegistry,
    private readonly logger: Logger,
    private readonly channelConfigs: Record<string, ChannelAccountConfig> = {},
    private readonly templateEngine?: TemplateEngine | null,
  ) {
    this.eventHandler = new EventHandler();
    this.eventHandler.events.on("partial", (sessionId, delta) => {
      const coalescer = this.activeCoalescers.get(sessionId);
      if (coalescer) coalescer.append(delta);
    });
    this.eventHandler.events.on("response", (sessionId, text) => {
      const coalescer = this.activeCoalescers.get(sessionId);
      if (coalescer) {
        coalescer.end();
        coalescer.dispose();
        this.activeCoalescers.delete(sessionId);
        this.pendingResponses.delete(sessionId);
      } else {
        this.handleResponse(sessionId, text);
      }
    });
    this.eventHandler.events.on("error", (sessionId, error) => {
      this.logger.error({ sessionId, error }, "Session error");
      const coalescer = this.activeCoalescers.get(sessionId);
      if (coalescer) {
        coalescer.dispose();
        this.activeCoalescers.delete(sessionId);
      }
      this.pendingResponses.delete(sessionId);
    });

    this.outboundQueue = new MessageQueue(logger);
    this.outboundQueue.setDeliveryFn(async (msg) => {
      const adapter = this.registry.get(msg.channelId);
      if (!adapter) throw new Error(`No adapter for ${msg.channelId}`);
      return adapter.sendText({
        to: msg.chatId,
        text: msg.text,
        replyToId: msg.replyToId,
      });
    });

    this.cleanupTimer = setInterval(() => this.pruneStale(), CLEANUP_INTERVAL_MS);
    // Don't keep the process alive just for cleanup
    this.cleanupTimer.unref();
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.eventHandler.dispose();
  }

  getEventHandler(): EventHandler {
    return this.eventHandler;
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    const log = this.logger.child({
      channel: msg.channelId,
      sender: msg.senderId,
      chat: msg.chatId,
    });

    // Security check
    const adapter = this.registry.get(msg.channelId);
    const checkResult: SecurityCheckResult = await this.securityGate.check({
      channelId: msg.channelId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      chatType: msg.chatType,
    });

    if (!checkResult.allowed) {
      log.info({ reason: checkResult.reason }, "Message rejected");
      if (checkResult.message && adapter) {
        await adapter.sendText({
          to: msg.chatId,
          text: checkResult.message,
          replyToId: msg.id,
        });
      }
      return;
    }

    // Mention gating for group messages
    const channelConfig = this.channelConfigs[msg.channelId];
    if (channelConfig?.groupPolicy?.enabled && channelConfig.groupPolicy.requireMention) {
      const mentionPattern = channelConfig.mentionPattern;
      const botId = adapter?.id ?? msg.channelId;
      if (!shouldProcessGroupMessage(msg, botId, mentionPattern)) {
        log.debug("Group message filtered (no bot mention)");
        return;
      }
    }

    // /new command — reset session
    if (msg.text?.trim().toLowerCase() === "/new" || msg.text?.trim().toLowerCase() === "/start") {
      const key = this.sessionMap.buildKey(msg.channelId, msg.chatId, msg.chatType);
      await this.sessionMap.reset(key);
      log.info("Session reset via /new command");
      if (adapter) {
        await adapter.sendText({
          to: msg.chatId,
          text: "Session reset. Send a message to start fresh.",
          replyToId: msg.id,
        });
      }
      return;
    }

    // Auto-reply check
    if (this.templateEngine) {
      const match = this.templateEngine.match(msg);
      if (match) {
        log.info({ templateId: match.template.id }, "Auto-reply matched");
        if (adapter) {
          await adapter.sendText({
            to: msg.chatId,
            text: match.response,
            replyToId: msg.id,
          });
        }
        if (!match.template.forwardToAi) return;
      }
    }

    // Resolve session
    const entry = await this.sessionMap.resolve(
      msg.channelId,
      msg.senderId,
      msg.chatId,
      msg.chatType,
      this.bridge,
    );

    log.info(
      { sessionId: entry.openCodeSessionId },
      "Routing message to OpenCode",
    );

    // Store pending response context
    this.pendingResponses.set(entry.openCodeSessionId, {
      channelId: msg.channelId,
      chatId: msg.chatId,
      replyToId: msg.id,
      createdAt: Date.now(),
    });

    // Send typing indicator
    await adapter?.sendTyping?.({ to: msg.chatId });

    // Strip bot mention from text before forwarding to OpenCode
    let messageText = msg.text ?? "";
    if (channelConfig?.groupPolicy?.enabled && channelConfig.groupPolicy.requireMention) {
      const mentionPattern = channelConfig.mentionPattern;
      const botId = adapter?.id ?? msg.channelId;
      messageText = stripBotMention(messageText, botId, mentionPattern);
    }

    // Set up streaming coalescer if enabled for this channel
    const streamConfig = channelConfig?.streaming;
    if (streamConfig?.enabled && adapter) {
      const maxLen = PLATFORM_LIMITS[msg.channelId] ?? adapter.capabilities.maxTextLength ?? 4096;
      const coalescer = new StreamCoalescer(
        {
          enabled: true,
          minChars: streamConfig.minChars ?? 300,
          maxChars: streamConfig.maxChars ?? maxLen,
          idleMs: streamConfig.idleMs ?? 800,
          breakOn: streamConfig.breakOn ?? "paragraph",
          editInPlace: streamConfig.editInPlace ?? false,
        },
        (text, isEdit) => {
          if (isEdit && adapter.editMessage) {
            // Edit-in-place: edit the last sent message
            adapter.editMessage({ messageId: "", text, chatId: msg.chatId }).catch(() => {});
          } else {
            this.outboundQueue.enqueue({
              channelId: msg.channelId,
              chatId: msg.chatId,
              text,
              replyToId: msg.id,
            });
          }
        },
      );
      this.activeCoalescers.set(entry.openCodeSessionId, coalescer);
    }

    // Send message to OpenCode (async, response comes via SSE events)
    await this.bridge.sendMessageAsync(
      entry.openCodeSessionId,
      messageText,
    );
  }

  async sendResponse(
    channelId: string,
    chatId: string,
    text: string,
    replyToId?: string,
  ): Promise<void> {
    const adapter = this.registry.get(channelId);
    if (!adapter) {
      this.logger.warn({ channelId }, "No adapter found for response");
      return;
    }

    const maxLen =
      PLATFORM_LIMITS[channelId] ?? adapter.capabilities.maxTextLength;
    const chunks = chunkText(text, maxLen);

    let currentReplyToId = replyToId;
    for (const chunk of chunks) {
      this.outboundQueue.enqueue({
        channelId,
        chatId,
        text: chunk,
        replyToId: currentReplyToId,
      });
      currentReplyToId = undefined; // Only reply to first chunk
    }
  }

  private handleResponse(sessionId: string, text: string): void {
    const pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      this.logger.warn({ sessionId }, "No pending response context");
      return;
    }
    this.pendingResponses.delete(sessionId);

    this.sendResponse(
      pending.channelId,
      pending.chatId,
      text,
      pending.replyToId,
    ).catch((err) => {
      this.logger.error({ err, sessionId }, "Failed to send response");
    });
  }

  private pruneStale(): void {
    const now = Date.now();
    for (const [sessionId, pending] of this.pendingResponses) {
      if (now - pending.createdAt > PENDING_TTL_MS) {
        this.logger.warn({ sessionId }, "Pruning stale pending response");
        this.pendingResponses.delete(sessionId);
      }
    }
  }
}
