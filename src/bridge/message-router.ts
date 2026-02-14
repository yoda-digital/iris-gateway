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
    private readonly profileEnricher?: { isFirstContact(profile: any): boolean } | null,
    private readonly vaultStoreRef?: { getProfile(senderId: string, channelId: string): any } | null,
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
    const startTime = Date.now();
    const log = this.logger.child({
      channel: msg.channelId,
      sender: msg.senderId,
      chat: msg.chatId,
    });

    const textPreview = msg.text ? `"${msg.text.substring(0, 60)}${msg.text.length > 60 ? "…" : ""}"` : "(no text)";
    log.info(`──── INBOUND ─── ${msg.channelId}/${msg.chatType} ─── ${textPreview}`);

    // ── Step 1: Adapter ──
    const adapter = this.registry.get(msg.channelId);
    log.info(`  1 ▸ Adapter        ${adapter ? "✓ " + msg.channelId : "✗ no adapter"}`);

    // ── Step 2: Security gate ──
    const checkResult: SecurityCheckResult = await this.securityGate.check({
      channelId: msg.channelId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      chatType: msg.chatType,
    });
    log.info(`  2 ▸ SecurityGate   ${checkResult.allowed ? "✓ allowed" : "✗ " + checkResult.reason}`);

    if (!checkResult.allowed) {
      if (checkResult.message && adapter) {
        await adapter.sendText({
          to: msg.chatId,
          text: checkResult.message,
          replyToId: msg.id,
        });
      }
      return;
    }

    // ── Step 3: Mention gating ──
    const channelConfig = this.channelConfigs[msg.channelId];
    if (channelConfig?.groupPolicy?.enabled && channelConfig.groupPolicy.requireMention) {
      const mentionPattern = channelConfig.mentionPattern;
      const botId = adapter?.id ?? msg.channelId;
      if (!shouldProcessGroupMessage(msg, botId, mentionPattern)) {
        log.info("  3 ▸ MentionGate   ✗ filtered (no bot mention)");
        return;
      }
      log.info("  3 ▸ MentionGate   ✓ mentioned");
    } else {
      log.info(`  3 ▸ MentionGate   ○ skipped (${msg.chatType})`);
    }

    // ── Step 4: Commands ──
    if (msg.text?.trim().toLowerCase() === "/new" || msg.text?.trim().toLowerCase() === "/start") {
      const key = this.sessionMap.buildKey(msg.channelId, msg.chatId, msg.chatType);
      await this.sessionMap.reset(key);
      log.info("  4 ▸ Command       /new → session reset");
      if (adapter) {
        await adapter.sendText({
          to: msg.chatId,
          text: "Session reset. Send a message to start fresh.",
          replyToId: msg.id,
        });
      }
      return;
    }
    log.info("  4 ▸ Commands      ○ not a command");

    // ── Step 5: Auto-reply ──
    if (this.templateEngine) {
      const match = this.templateEngine.match(msg);
      if (match) {
        log.info(`  5 ▸ AutoReply     ✓ matched "${match.template.id}"${match.template.forwardToAi ? " (+ forward)" : ""}`);
        if (adapter) {
          await adapter.sendText({
            to: msg.chatId,
            text: match.response,
            replyToId: msg.id,
          });
        }
        if (!match.template.forwardToAi) return;
      } else {
        log.info("  5 ▸ AutoReply     ○ no match");
      }
    } else {
      log.info("  5 ▸ AutoReply     ○ disabled");
    }

    // ── Step 6: First contact detection ──
    let firstContactPrefix = "";
    if (this.profileEnricher && this.vaultStoreRef) {
      const profile = this.vaultStoreRef.getProfile(msg.senderId, msg.channelId);
      if (profile && this.profileEnricher.isFirstContact(profile)) {
        firstContactPrefix = `[FIRST CONTACT — NEW USER]\nThis user just messaged you for the first time.\nChannel: ${msg.channelId}\n\nRespond in the SAME LANGUAGE as their message.\nWelcome naturally — warm but not formulaic.\nAs you learn things (name, language, timezone, interests), use enrich_profile to store them.\nDo NOT ask multiple questions at once — learn gradually through conversation.\nPick up on cues from their message — if they ask a question, help first, get to know them second.\n\n---\n\n`;
        log.info("  6 ▸ FirstContact  ✓ new user → meta-prompt injected");
      } else {
        log.info("  6 ▸ FirstContact  ○ returning user");
      }
    } else {
      log.info("  6 ▸ FirstContact  ○ enricher disabled");
    }

    // ── Step 7: Session resolution ──
    const entry = await this.sessionMap.resolve(
      msg.channelId,
      msg.senderId,
      msg.chatId,
      msg.chatType,
      this.bridge,
    );
    log.info(`  7 ▸ Session       ✓ ${entry.openCodeSessionId}`);

    // Store pending response context
    this.pendingResponses.set(entry.openCodeSessionId, {
      channelId: msg.channelId,
      chatId: msg.chatId,
      replyToId: msg.id,
      createdAt: Date.now(),
    });

    // ── Step 8: Typing indicator ──
    await adapter?.sendTyping?.({ to: msg.chatId });
    log.info("  8 ▸ Typing        ✓ sent");

    // Strip bot mention from text before forwarding to OpenCode
    let messageText = msg.text ?? "";
    if (channelConfig?.groupPolicy?.enabled && channelConfig.groupPolicy.requireMention) {
      const mentionPattern = channelConfig.mentionPattern;
      const botId = adapter?.id ?? msg.channelId;
      messageText = stripBotMention(messageText, botId, mentionPattern);
    }

    // Prepend first-contact meta-prompt if applicable
    if (firstContactPrefix) {
      messageText = firstContactPrefix + messageText;
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

    // ── Step 9: OpenCode bridge ──
    log.info("  9 ▸ Bridge        → prompt_async to OpenCode");
    log.info("  ── HOOKS ── system.transform → vault context + profile learning + proactive awareness");
    log.info("  ── MODEL ── thinking + tool calls (see ⚡ below) + response generation");

    const response = await this.bridge.sendAndWait(
      entry.openCodeSessionId,
      messageText,
    );

    // Clean up streaming coalescer (not used in polling path)
    const coalescer = this.activeCoalescers.get(entry.openCodeSessionId);
    if (coalescer) {
      coalescer.dispose();
      this.activeCoalescers.delete(entry.openCodeSessionId);
    }
    this.pendingResponses.delete(entry.openCodeSessionId);

    // ── Step 10: Response delivery ──
    const elapsed = Date.now() - startTime;
    if (response) {
      const responsePreview = `"${response.substring(0, 80)}${response.length > 80 ? "…" : ""}"`;
      log.info(` 10 ▸ Response      ✓ ${response.length}ch in ${elapsed}ms`);
      log.info(` 11 ▸ Deliver       → ${msg.channelId} ${responsePreview}`);
      await this.sendResponse(msg.channelId, msg.chatId, response, msg.id);
      log.info(`──── DONE ──── ${elapsed}ms total ────`);
    } else {
      log.warn(` 10 ▸ Response      ✗ empty (${elapsed}ms) — model may be unavailable`);
      log.info(`──── DONE ──── ${elapsed}ms total (no response) ────`);
    }
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
