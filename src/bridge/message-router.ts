import type { InboundMessage } from "../channels/adapter.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { SecurityGate, SecurityCheckResult } from "../security/dm-policy.js";
import type { Logger } from "../logging/logger.js";
import type { ChannelAccountConfig } from "../config/types.js";
import { chunkText, PLATFORM_LIMITS } from "../utils/text-chunker.js";
import { shouldProcessGroupMessage, stripBotMention } from "../channels/mention-gating.js";
import type { OpenCodeBridge, Permission } from "./opencode-client.js";
import type { PolicyEngine } from "../governance/policy.js";
import type { SessionMap } from "./session-map.js";
import { EventHandler } from "./event-handler.js";
import { MessageQueue } from "./message-queue.js";
import { StreamCoalescer } from "./stream-coalescer.js";
import { TurnGrouper } from "./turn-grouper.js";
import { recordReceived, recordSent, recordError, recordLatency } from "./router-metrics.js";
import type { TemplateEngine } from "../auto-reply/engine.js";

export class MessageRouter {
  private readonly eventHandler: EventHandler;
  private readonly turnGrouper: TurnGrouper;
  private readonly activeCoalescers = new Map<string, StreamCoalescer>();
  private readonly outboundQueue: MessageQueue;

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
    private readonly policyEngine?: PolicyEngine | null,
  ) {
    this.turnGrouper = new TurnGrouper((sessionId) => {
      this.logger.warn({ sessionId }, "Pruning stale pending response");
    });

    this.eventHandler = new EventHandler();
    this.eventHandler.events.on("partial", (sessionId, delta) => {
      this.activeCoalescers.get(sessionId)?.append(delta);
    });
    this.eventHandler.events.on("response", (sessionId, text) => {
      const coalescer = this.activeCoalescers.get(sessionId);
      if (coalescer) {
        coalescer.end();
        coalescer.dispose();
        this.activeCoalescers.delete(sessionId);
        this.turnGrouper.delete(sessionId);
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
      const pending = this.turnGrouper.get(sessionId);
      this.turnGrouper.delete(sessionId);
      if (pending) {
        const reason = error instanceof Error ? error.message : "An unexpected error occurred";
        this.sendResponse(pending.channelId, pending.chatId, `⚠️ Request failed: ${reason}`, pending.replyToId).catch((err) => {
          this.logger.error({ err, sessionId }, "Failed to send error response");
        });
      }
    });

    this.eventHandler.events.on("permissionRequest", (sessionId, permission) => {
      void this.handlePermissionRequest(sessionId, permission);
    });

    this.outboundQueue = new MessageQueue(logger);
    this.outboundQueue.setDeliveryFn(async (msg) => {
      const adapter = this.registry.get(msg.channelId);
      if (!adapter) throw new Error(`No adapter for ${msg.channelId}`);
      return adapter.sendText({ to: msg.chatId, text: msg.text, replyToId: msg.replyToId });
    });
  }

  dispose(): void {
    this.turnGrouper.dispose();
    this.eventHandler.dispose();
  }

  getEventHandler(): EventHandler {
    return this.eventHandler;
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    const startTime = Date.now();
    const log = this.logger.child({ channel: msg.channelId, sender: msg.senderId, chat: msg.chatId });
    const textPreview = msg.text
      ? `"${msg.text.substring(0, 60)}${msg.text.length > 60 ? "…" : ""}"`
      : "(no text)";
    log.info(`──── INBOUND ─── ${msg.channelId}/${msg.chatType} ─── ${textPreview}`);
    recordReceived(msg.channelId);

    const adapter = this.registry.get(msg.channelId);
    log.info(`  1 ▸ Adapter        ${adapter ? "✓ " + msg.channelId : "✗ no adapter"}`);

    const checkResult: SecurityCheckResult = await this.securityGate.check({
      channelId: msg.channelId, senderId: msg.senderId,
      senderName: msg.senderName, chatType: msg.chatType,
    });
    log.info(`  2 ▸ SecurityGate   ${checkResult.allowed ? "✓ allowed" : "✗ " + checkResult.reason}`);
    if (!checkResult.allowed) {
      if (checkResult.message && adapter) {
        await adapter.sendText({ to: msg.chatId, text: checkResult.message, replyToId: msg.id });
      }
      return;
    }

    const channelConfig = this.channelConfigs[msg.channelId];
    if (channelConfig?.groupPolicy?.enabled && channelConfig.groupPolicy.requireMention) {
      const botId = adapter?.id ?? msg.channelId;
      if (!shouldProcessGroupMessage(msg, botId, channelConfig.mentionPattern)) {
        log.info("  3 ▸ MentionGate   ✗ filtered (no bot mention)");
        return;
      }
      log.info("  3 ▸ MentionGate   ✓ mentioned");
    } else {
      log.info(`  3 ▸ MentionGate   ○ skipped (${msg.chatType})`);
    }

    if (msg.text?.trim().toLowerCase() === "/new" || msg.text?.trim().toLowerCase() === "/start") {
      const key = this.sessionMap.buildKey(msg.channelId, msg.chatId, msg.chatType);
      await this.sessionMap.reset(key);
      log.info("  4 ▸ Command       /new → session reset");
      if (adapter) {
        await adapter.sendText({ to: msg.chatId, text: "Session reset. Send a message to start fresh.", replyToId: msg.id });
      }
      return;
    }
    log.info("  4 ▸ Commands      ○ not a command");

    if (this.templateEngine) {
      const match = this.templateEngine.match(msg);
      if (match) {
        log.info(`  5 ▸ AutoReply     ✓ matched "${match.template.id}"${match.template.forwardToAi ? " (+ forward)" : ""}`);
        if (adapter) await adapter.sendText({ to: msg.chatId, text: match.response, replyToId: msg.id });
        if (!match.template.forwardToAi) return;
      } else {
        log.info("  5 ▸ AutoReply     ○ no match");
      }
    } else {
      log.info("  5 ▸ AutoReply     ○ disabled");
    }

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

    const entry = await this.sessionMap.resolve(
      msg.channelId, msg.senderId, msg.chatId, msg.chatType, this.bridge,
    );
    log.info(`  7 ▸ Session       ✓ ${entry.openCodeSessionId}`);
    this.turnGrouper.set(entry.openCodeSessionId, {
      channelId: msg.channelId, chatId: msg.chatId, replyToId: msg.id,
    });

    await adapter?.sendTyping?.({ to: msg.chatId });
    log.info("  8 ▸ Typing        ✓ sent");

    let messageText = msg.text ?? "";
    if (channelConfig?.groupPolicy?.enabled && channelConfig.groupPolicy.requireMention) {
      const botId = adapter?.id ?? msg.channelId;
      messageText = stripBotMention(messageText, botId, channelConfig.mentionPattern);
    }
    if (firstContactPrefix) messageText = firstContactPrefix + messageText;

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
            this.outboundQueue.enqueue({ channelId: msg.channelId, chatId: msg.chatId, text, replyToId: msg.id });
          }
        },
      );
      this.activeCoalescers.set(entry.openCodeSessionId, coalescer);
    }

    const cb = this.bridge.getCircuitBreaker();
    if (!cb.allowRequest()) {
      log.warn("  9 ▸ Bridge        ✗ circuit OPEN — rejecting, notifying user");
      if (adapter) {
        await adapter.sendText({ to: msg.chatId, text: cb.unavailableMessage, replyToId: msg.id }).catch(() => {});
      }
      this.turnGrouper.delete(entry.openCodeSessionId);
      return;
    }

    log.info("  9 ▸ Bridge        → prompt_async to OpenCode");

    let response: string | null = null;
    try {
      const sendTimeoutMs = this.channelConfigs[msg.channelId]?.sendAndWaitTimeoutMs;
      const agent = this.selectAgent(messageText, msg.channelId);
      response = await this.bridge.sendAndWait(entry.openCodeSessionId, messageText, sendTimeoutMs, undefined, agent);
    } catch (err) {
      cb.onFailure();
      recordError(msg.channelId, "bridge_error");
      log.error({ err }, "  9 ▸ Bridge        ✗ sendAndWait threw");
      throw err;
    }

    // Check whether SSE path already consumed this turn before sendAndWait returned.
    // turnGrouper.get() returns undefined once SSE's handleResponse() deleted it.
    // Note: a missing entry also covers the streaming-coalescer path (which calls
    // turnGrouper.delete() when coalescer.end() fires) — both are correct no-ops here.
    const sseAlreadyDelivered = !this.turnGrouper.get(entry.openCodeSessionId);

    // Mark as delivered so SSE path doesn't double-deliver if it fires concurrently
    this.eventHandler.markDelivered(entry.openCodeSessionId);

    const coalescer = this.activeCoalescers.get(entry.openCodeSessionId);
    if (coalescer) {
      coalescer.dispose();
      this.activeCoalescers.delete(entry.openCodeSessionId);
    }
    this.turnGrouper.delete(entry.openCodeSessionId);

    const elapsed = Date.now() - startTime;
    if (sseAlreadyDelivered) {
      // SSE path already delivered; polling is the fallback — skip to avoid duplicate
      cb.onSuccess();
      log.info(` 10 ▸ Response      ○ SSE already delivered (${elapsed}ms) — polling skipped`);
      log.info(`──── DONE ──── ${elapsed}ms total (SSE-delivered) ────`);
    } else if (response) {
      cb.onSuccess();
      const responsePreview = `"${response.substring(0, 80)}${response.length > 80 ? "…" : ""}"`;
      log.info(` 10 ▸ Response      ✓ ${response.length}ch in ${elapsed}ms`);
      log.info(` 11 ▸ Deliver       → ${msg.channelId} ${responsePreview}`);
      await this.sendResponse(msg.channelId, msg.chatId, response, msg.id);
      recordLatency(msg.channelId, elapsed);
      recordSent(msg.channelId);
      log.info(`──── DONE ──── ${elapsed}ms total ────`);
    } else {
      cb.onFailure();
      recordError(msg.channelId, "empty_response");
      log.warn(` 10 ▸ Response      ✗ empty (${elapsed}ms) — model may be unavailable`);
      log.info(`──── DONE ──── ${elapsed}ms total (no response) ────`);
    }
  }

  async sendResponse(channelId: string, chatId: string, text: string, replyToId?: string): Promise<void> {
    const adapter = this.registry.get(channelId);
    if (!adapter) {
      this.logger.warn({ channelId }, "No adapter found for response");
      return;
    }
    const maxLen = PLATFORM_LIMITS[channelId] ?? adapter.capabilities.maxTextLength;
    const chunks = chunkText(text, maxLen);
    let currentReplyToId = replyToId;
    for (const chunk of chunks) {
      this.outboundQueue.enqueue({ channelId, chatId, text: chunk, replyToId: currentReplyToId });
      currentReplyToId = undefined;
    }
  }

  private selectAgent(text: string, channelId: string): string {
    // Per-channel override takes priority
    const override = this.channelConfigs[channelId]?.defaultAgent;
    if (override) return override;

    const t = text.toLowerCase();

    // Coding execution — needs real tools
    if (/\b(fix|implement|write|create|refactor|delete|rename|move|update)\b.*\b(file|function|class|component|test|bug|issue|error)\b/.test(t)) {
      return "build";
    }

    // Architecture and planning
    if (/\b(plan|design|architect|how should|what.?s the best way|structure|approach)\b/.test(t)) {
      return "plan";
    }

    // Codebase investigation
    if (/\b(explore|understand|find|where is|what does|explain|navigate|show me|locate)\b.*\b(codebase|repo|code|file|function|module|class)\b/.test(t)) {
      return "explore";
    }

    return "chat";
  }

  private handleResponse(sessionId: string, text: string): void {
    const pending = this.turnGrouper.get(sessionId);
    if (!pending) {
      this.logger.warn({ sessionId }, "No pending response context");
      return;
    }
    this.turnGrouper.delete(sessionId);
    this.sendResponse(pending.channelId, pending.chatId, text, pending.replyToId).catch((err) => {
      this.logger.error({ err, sessionId }, "Failed to send response");
    });
  }

  // ── Permission handling ──

  private async handlePermissionRequest(sessionId: string, permission: Permission): Promise<void> {
    const log = this.logger.child({ sessionId, permissionId: permission.id, permissionType: permission.type });
    log.info("Permission request received");

    if (this.isAutoDenied(permission)) {
      log.info("Auto-denying permission (policy or blocked type)");
      await this.bridge.approvePermission(sessionId, permission.id, "reject").catch((err) => {
        log.error({ err }, "Failed to auto-deny permission");
      });
      return;
    }

    if (this.isAutoApproved(permission)) {
      log.info("Auto-approving permission (read-only / policy allowed)");
      await this.bridge.approvePermission(sessionId, permission.id, "once").catch((err) => {
        log.error({ err }, "Failed to auto-approve permission");
      });
      return;
    }

    // Unknown/sensitive permission type: deny by default.
    // Interactive user approval (/perm command) is not yet implemented.
    log.info("Auto-denying unrecognised permission type");
    await this.bridge.approvePermission(sessionId, permission.id, "reject").catch((err) => {
      log.error({ err }, "Failed to deny permission");
    });
  }

  private isAutoApproved(permission: Permission): boolean {
    const readOnlyTypes = ["read", "list", "search", "stat"];
    return readOnlyTypes.some((t) => permission.type === t);
  }

  private isAutoDenied(permission: Permission): boolean {
    // "bash" and "edit" are dangerous regardless of policy config; deny them
    // when no policyEngine is present. When policyEngine is present, it is
    // the authoritative source and covers all permission types including these.
    if (this.policyEngine) {
      return this.policyEngine.isPermissionDenied(permission.type);
    }
    const blockedTypes = ["bash", "edit"];
    return blockedTypes.some((t) => permission.type === t);
  }

}
