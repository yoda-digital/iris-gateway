import { randomUUID } from "node:crypto";
import type { VaultDB } from "../vault/db.js";
import type {
  ProactiveIntent,
  ProactiveTrigger,
  QuotaStatus,
  DormantUser,
  AddIntentParams,
  AddTriggerParams,
} from "./types.js";

interface LogParams {
  readonly senderId: string;
  readonly channelId: string;
  readonly type: "intent" | "trigger";
  readonly sourceId: string;
}

export class IntentStore {
  private readonly db;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
  }

  // ── Intents (active layer) ──

  addIntent(params: AddIntentParams): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO proactive_intents
         (id, session_id, channel_id, chat_id, sender_id, what, why, confidence, execute_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.sessionId,
        params.channelId,
        params.chatId,
        params.senderId,
        params.what,
        params.why ?? null,
        params.confidence ?? 0.8,
        params.executeAt,
        Date.now(),
      );
    return id;
  }

  listPendingIntents(limit = 10): ProactiveIntent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM proactive_intents
         WHERE executed_at IS NULL AND execute_at <= ?
         ORDER BY execute_at ASC LIMIT ?`,
      )
      .all(Date.now(), limit) as Record<string, unknown>[];
    return rows.map((r) => this.toIntent(r));
  }

  listAllPending(limit = 20): { intents: ProactiveIntent[]; triggers: ProactiveTrigger[] } {
    return {
      intents: this.listPendingIntents(limit),
      triggers: this.listPendingTriggers(limit),
    };
  }

  cancelIntent(id: string): boolean {
    const result = this.db
      .prepare("UPDATE proactive_intents SET executed_at = ?, result = 'cancelled' WHERE id = ? AND executed_at IS NULL")
      .run(Date.now(), id);
    return result.changes > 0;
  }

  markIntentExecuted(id: string, result: string): void {
    this.db
      .prepare("UPDATE proactive_intents SET executed_at = ?, result = ? WHERE id = ?")
      .run(Date.now(), result, id);
  }

  // ── Triggers (passive layer) ──

  addTrigger(params: AddTriggerParams): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO proactive_triggers
         (id, type, channel_id, chat_id, sender_id, context, execute_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, params.type, params.channelId, params.chatId, params.senderId, params.context, params.executeAt);
    return id;
  }

  listPendingTriggers(limit = 10): ProactiveTrigger[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM proactive_triggers
         WHERE executed_at IS NULL AND execute_at <= ?
         ORDER BY execute_at ASC LIMIT ?`,
      )
      .all(Date.now(), limit) as Record<string, unknown>[];
    return rows.map((r) => this.toTrigger(r));
  }

  hasPendingTrigger(senderId: string, type: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM proactive_triggers WHERE sender_id = ? AND type = ? AND executed_at IS NULL LIMIT 1",
      )
      .get(senderId, type);
    return row !== undefined;
  }

  markTriggerExecuted(id: string, result: string): void {
    this.db
      .prepare("UPDATE proactive_triggers SET executed_at = ?, result = ? WHERE id = ?")
      .run(Date.now(), result, id);
  }

  // ── Engagement tracking + soft quotas ──

  logProactiveMessage(params: LogParams): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO proactive_log (id, sender_id, channel_id, type, source_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, params.senderId, params.channelId, params.type, params.sourceId, Date.now());
    return id;
  }

  markEngaged(senderId: string, channelId: string): void {
    this.db
      .prepare(
        `UPDATE proactive_log SET engaged = 1, engagement_at = ?
         WHERE id = (
           SELECT id FROM proactive_log
           WHERE sender_id = ? AND channel_id = ? AND engaged = 0
           ORDER BY sent_at DESC LIMIT 1
         )`,
      )
      .run(Date.now(), senderId, channelId);
  }

  getQuotaStatus(senderId: string, channelId: string, perUserPerDay: number): QuotaStatus {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM proactive_log
         WHERE sender_id = ? AND channel_id = ? AND sent_at >= ?`,
      )
      .get(senderId, channelId, todayStart.getTime()) as { cnt: number };

    const sentToday = row.cnt;
    const rate = this.getEngagementRate(senderId, channelId);

    return {
      allowed: sentToday < perUserPerDay,
      sentToday,
      limit: perUserPerDay,
      engagementRate: rate,
    };
  }

  getEngagementRate(senderId: string, channelId: string): number {
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as total, SUM(engaged) as engaged FROM proactive_log
         WHERE sender_id = ? AND channel_id = ? AND sent_at >= ?`,
      )
      .get(senderId, channelId, thirtyDaysAgo) as { total: number; engaged: number | null };

    if (row.total === 0) return 0;
    return (row.engaged ?? 0) / row.total;
  }

  getGlobalQuotaToday(): number {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM proactive_log WHERE sent_at >= ?")
      .get(todayStart.getTime()) as { cnt: number };
    return row.cnt;
  }

  // ── Dormant user detection ──

  listDormantUsers(thresholdMs: number, limit: number): DormantUser[] {
    const cutoff = Date.now() - thresholdMs;
    const rows = this.db
      .prepare(
        `SELECT sender_id, channel_id, name, last_seen FROM profiles
         WHERE last_seen < ? AND last_seen > 0
         AND sender_id NOT IN (
           SELECT sender_id FROM proactive_triggers
           WHERE type = 'dormant_user' AND executed_at IS NULL
         )
         ORDER BY last_seen ASC LIMIT ?`,
      )
      .all(cutoff, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      senderId: r["sender_id"] as string,
      channelId: r["channel_id"] as string,
      name: (r["name"] as string) ?? null,
      lastSeen: r["last_seen"] as number,
    }));
  }

  // ── Cleanup ──

  purgeExpired(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const intents = this.db
      .prepare("DELETE FROM proactive_intents WHERE executed_at IS NULL AND execute_at < ?")
      .run(cutoff);
    const triggers = this.db
      .prepare("DELETE FROM proactive_triggers WHERE executed_at IS NULL AND execute_at < ?")
      .run(cutoff);
    return intents.changes + triggers.changes;
  }

  // ── Row mappers ──

  private toIntent(row: Record<string, unknown>): ProactiveIntent {
    return {
      id: row["id"] as string,
      sessionId: row["session_id"] as string,
      channelId: row["channel_id"] as string,
      chatId: row["chat_id"] as string,
      senderId: row["sender_id"] as string,
      what: row["what"] as string,
      why: (row["why"] as string) ?? null,
      confidence: row["confidence"] as number,
      executeAt: row["execute_at"] as number,
      executedAt: (row["executed_at"] as number) ?? null,
      result: (row["result"] as string) ?? null,
      createdAt: row["created_at"] as number,
    };
  }

  private toTrigger(row: Record<string, unknown>): ProactiveTrigger {
    return {
      id: row["id"] as string,
      type: row["type"] as ProactiveTrigger["type"],
      channelId: row["channel_id"] as string,
      chatId: row["chat_id"] as string,
      senderId: row["sender_id"] as string,
      context: row["context"] as string,
      executeAt: row["execute_at"] as number,
      executedAt: (row["executed_at"] as number) ?? null,
      result: (row["result"] as string) ?? null,
    };
  }
}
