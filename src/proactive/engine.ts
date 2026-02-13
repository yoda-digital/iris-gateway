import type { IntentStore } from "./store.js";
import type { ProactiveConfig, ProactiveIntent, ProactiveTrigger } from "./types.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";
import type { MessageRouter } from "../bridge/message-router.js";
import type { SessionMap } from "../bridge/session-map.js";
import type { VaultStore } from "../vault/store.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { Logger } from "../logging/logger.js";

interface PulseEngineDeps {
  store: IntentStore;
  bridge: OpenCodeBridge;
  router: MessageRouter;
  sessionMap: SessionMap;
  vaultStore: VaultStore;
  registry: ChannelRegistry;
  logger: Logger;
  config: ProactiveConfig;
}

const SKIP_MARKER = "[SKIP]";
const DEFER_REGEX = /^\[DEFER\s+(\d+)h\]$/i;

export class PulseEngine {
  private readonly store: IntentStore;
  private readonly bridge: OpenCodeBridge;
  private readonly router: MessageRouter;
  private readonly sessionMap: SessionMap;
  private readonly vaultStore: VaultStore;
  private readonly registry: ChannelRegistry;
  private readonly logger: Logger;
  private readonly config: ProactiveConfig;

  private fastTimer: ReturnType<typeof setInterval> | null = null;
  private slowTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: PulseEngineDeps) {
    this.store = deps.store;
    this.bridge = deps.bridge;
    this.router = deps.router;
    this.sessionMap = deps.sessionMap;
    this.vaultStore = deps.vaultStore;
    this.registry = deps.registry;
    this.logger = deps.logger;
    this.config = deps.config;
  }

  start(): void {
    this.fastTimer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error({ err }, "Pulse tick error");
      });
    }, this.config.pollIntervalMs);
    this.fastTimer.unref();

    if (this.config.dormancy.enabled) {
      this.slowTimer = setInterval(() => {
        this.passiveScan().catch((err) => {
          this.logger.error({ err }, "Passive scan error");
        });
      }, this.config.passiveScanIntervalMs);
      this.slowTimer.unref();
    }

    this.logger.info("Proactive pulse engine started");
  }

  stop(): void {
    if (this.fastTimer) {
      clearInterval(this.fastTimer);
      this.fastTimer = null;
    }
    if (this.slowTimer) {
      clearInterval(this.slowTimer);
      this.slowTimer = null;
    }
    this.logger.info("Proactive pulse engine stopped");
  }

  async tick(): Promise<void> {
    const purged = this.store.purgeExpired(this.config.intentDefaults.maxAgeMs);
    if (purged > 0) {
      this.logger.debug({ purged }, "Purged expired proactive items");
    }

    const intents = this.store.listPendingIntents(10);
    for (const intent of intents) {
      await this.executeIntent(intent);
    }

    const triggers = this.store.listPendingTriggers(10);
    for (const trigger of triggers) {
      await this.executeTrigger(trigger);
    }
  }

  async passiveScan(): Promise<void> {
    if (!this.config.dormancy.enabled) return;

    const dormant = this.store.listDormantUsers(
      this.config.dormancy.thresholdMs,
      10,
    );

    for (const user of dormant) {
      const daysInactive = Math.floor(
        (Date.now() - user.lastSeen) / 86_400_000,
      );
      this.store.addTrigger({
        type: "dormant_user",
        channelId: user.channelId,
        chatId: user.senderId,
        senderId: user.senderId,
        context: `User "${user.name ?? "unknown"}" inactive for ${daysInactive} days.`,
        executeAt: Date.now() + 3_600_000,
      });
      this.logger.debug(
        { senderId: user.senderId, daysInactive },
        "Dormant user trigger created",
      );
    }
  }

  private async executeIntent(intent: ProactiveIntent): Promise<void> {
    try {
      if (intent.confidence < this.config.intentDefaults.confidenceThreshold) {
        this.store.markIntentExecuted(intent.id, "low_confidence");
        this.logger.debug({ id: intent.id, confidence: intent.confidence }, "Skipped low confidence intent");
        return;
      }

      const quota = this.store.getQuotaStatus(
        intent.senderId,
        intent.channelId,
        this.config.softQuotas.perUserPerDay,
      );
      if (!quota.allowed) {
        this.logger.debug({ id: intent.id, sentToday: quota.sentToday }, "Skipped: quota exceeded");
        return;
      }

      if (this.store.getGlobalQuotaToday() >= this.config.softQuotas.globalPerDay) {
        this.logger.debug({ id: intent.id }, "Skipped: global quota exceeded");
        return;
      }

      if (this.isQuietHours(intent.senderId, intent.channelId)) {
        this.logger.debug({ id: intent.id }, "Skipped: quiet hours");
        return;
      }

      const result = await this.executeProactive({
        channelId: intent.channelId,
        chatId: intent.chatId,
        senderId: intent.senderId,
        chatType: "dm",
        prompt: this.buildIntentPrompt(intent, quota.engagementRate, quota.sentToday, quota.limit),
        sourceId: intent.id,
        sourceType: "intent",
      });

      this.store.markIntentExecuted(intent.id, result);
    } catch (err) {
      this.logger.error({ err, id: intent.id }, "Intent execution failed");
      this.store.markIntentExecuted(intent.id, "error");
    }
  }

  private async executeTrigger(trigger: ProactiveTrigger): Promise<void> {
    try {
      const quota = this.store.getQuotaStatus(
        trigger.senderId,
        trigger.channelId,
        this.config.softQuotas.perUserPerDay,
      );
      if (!quota.allowed) {
        this.logger.debug({ id: trigger.id }, "Trigger skipped: quota exceeded");
        return;
      }

      if (this.store.getGlobalQuotaToday() >= this.config.softQuotas.globalPerDay) {
        this.logger.debug({ id: trigger.id }, "Trigger skipped: global quota exceeded");
        return;
      }

      if (this.isQuietHours(trigger.senderId, trigger.channelId)) {
        this.logger.debug({ id: trigger.id }, "Trigger skipped: quiet hours");
        return;
      }

      const result = await this.executeProactive({
        channelId: trigger.channelId,
        chatId: trigger.chatId,
        senderId: trigger.senderId,
        chatType: "dm",
        prompt: this.buildTriggerPrompt(trigger, quota.engagementRate, quota.sentToday, quota.limit),
        sourceId: trigger.id,
        sourceType: "trigger",
      });

      this.store.markTriggerExecuted(trigger.id, result);
    } catch (err) {
      this.logger.error({ err, id: trigger.id }, "Trigger execution failed");
      this.store.markTriggerExecuted(trigger.id, "error");
    }
  }

  private async executeProactive(params: {
    channelId: string;
    chatId: string;
    senderId: string;
    chatType: "dm" | "group";
    prompt: string;
    sourceId: string;
    sourceType: "intent" | "trigger";
  }): Promise<string> {
    const entry = await this.sessionMap.resolve(
      params.channelId,
      params.senderId,
      params.chatId,
      params.chatType,
      this.bridge as any,
    );

    const response = await this.bridge.sendAndWait(
      entry.openCodeSessionId,
      params.prompt,
    );

    if (!response || response.trim() === SKIP_MARKER) {
      this.logger.debug({ sourceId: params.sourceId }, "AI chose to skip");
      return "skipped";
    }

    const deferMatch = response.trim().match(DEFER_REGEX);
    if (deferMatch) {
      const hours = parseInt(deferMatch[1], 10);
      this.logger.debug({ sourceId: params.sourceId, hours }, "AI deferred");
      return "deferred";
    }

    await this.router.sendResponse(params.channelId, params.chatId, response);

    this.store.logProactiveMessage({
      senderId: params.senderId,
      channelId: params.channelId,
      type: params.sourceType,
      sourceId: params.sourceId,
    });

    this.logger.info(
      { senderId: params.senderId, channelId: params.channelId, sourceType: params.sourceType },
      "Proactive message sent",
    );

    return "sent";
  }

  private buildIntentPrompt(
    intent: ProactiveIntent,
    engagementRate: number,
    sentToday: number,
    limit: number,
  ): string {
    const elapsed = Date.now() - intent.createdAt;
    const hoursAgo = Math.floor(elapsed / 3_600_000);
    const timeAgo = hoursAgo >= 24
      ? `${Math.floor(hoursAgo / 24)} days ago`
      : `${hoursAgo} hours ago`;

    const profile = this.vaultStore.getProfile(intent.senderId, intent.channelId);
    const profileBlock = profile
      ? `User: ${profile.name ?? "unknown"} | ${profile.timezone ?? "no timezone"} | ${profile.language ?? ""}`
      : "User: unknown";

    return `[PROACTIVE FOLLOW-UP]
You registered an intent ${timeAgo}: "${intent.what}"
${intent.why ? `Reason: "${intent.why}"` : ""}

${profileBlock}
Your quota: ${limit - sentToday}/${limit} proactive messages remaining today
Your engagement rate: ${Math.round(engagementRate * 100)}% of proactive messages get replies

Decide: Should you follow up now? If yes, compose a natural, helpful message.
Use any tools you need (send_message, vault_remember, canvas_update, etc.).
If not worth it, respond with just: [SKIP]
If you want to try later, respond with: [DEFER Xh] (replace X with hours)`;
  }

  private buildTriggerPrompt(
    trigger: ProactiveTrigger,
    engagementRate: number,
    sentToday: number,
    limit: number,
  ): string {
    const profile = this.vaultStore.getProfile(trigger.senderId, trigger.channelId);
    const profileBlock = profile
      ? `User: ${profile.name ?? "unknown"} | ${profile.timezone ?? "no timezone"} | ${profile.language ?? ""}`
      : "User: unknown";

    return `[PROACTIVE OUTREACH — ${trigger.type.replace(/_/g, " ").toUpperCase()}]
${trigger.context}

${profileBlock}
Your quota: ${limit - sentToday}/${limit} proactive messages remaining today
Your engagement rate: ${Math.round(engagementRate * 100)}% of proactive messages get replies

Decide: Should you reach out? If yes, compose a natural, warm message.
If not appropriate, respond with just: [SKIP]
If you want to try later, respond with: [DEFER Xh]`;
  }

  private isQuietHours(senderId: string, channelId: string): boolean {
    const profile = this.vaultStore.getProfile(senderId, channelId);
    const tz = profile?.timezone;

    let hour: number;
    if (tz) {
      try {
        hour = parseInt(
          new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false }),
          10,
        );
      } catch {
        hour = new Date().getHours();
      }
    } else {
      hour = new Date().getHours();
    }

    const { start, end } = this.config.quietHours;
    if (start > end) {
      return hour >= start || hour < end;
    }
    return hour >= start && hour < end;
  }
}
