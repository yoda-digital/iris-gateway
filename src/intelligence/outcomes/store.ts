import type Database from "better-sqlite3";
import type { VaultDB } from "../../vault/db.js";
import { randomUUID } from "node:crypto";
import type { ProactiveOutcome, CategoryRate, TimingPattern } from "../types.js";

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS proactive_outcomes (
  id                TEXT PRIMARY KEY,
  intent_id         TEXT NOT NULL,
  sender_id         TEXT NOT NULL,
  channel_id        TEXT NOT NULL,
  category          TEXT NOT NULL,
  sent_at           INTEGER NOT NULL,
  engaged           INTEGER DEFAULT 0,
  engaged_at        INTEGER,
  response_quality  TEXT,
  time_to_engage_ms INTEGER,
  day_of_week       INTEGER,
  hour_of_day       INTEGER,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outcomes_sender_cat ON proactive_outcomes(sender_id, category);
CREATE INDEX IF NOT EXISTS idx_outcomes_sender_time ON proactive_outcomes(sender_id, sent_at);`;

export class OutcomesStore {
  private readonly db: Database.Database;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
    this.db.exec(SCHEMA_SQL);
  }

  // ── Proactive Outcomes ──

  recordOutcome(params: {
    intentId: string;
    senderId: string;
    channelId: string;
    category: string;
    sentAt: number;
    dayOfWeek: number;
    hourOfDay: number;
  }): ProactiveOutcome {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO proactive_outcomes (id, intent_id, sender_id, channel_id, category, sent_at, day_of_week, hour_of_day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, params.intentId, params.senderId, params.channelId, params.category, params.sentAt, params.dayOfWeek, params.hourOfDay, now);
    return this.getOutcome(id)!;
  }

  markEngaged(senderId: string, engagedAt: number, quality: string): boolean {
    const cutoff = engagedAt - 86_400_000; // 24h window
    const row = this.db.prepare(
      `SELECT id, sent_at FROM proactive_outcomes
       WHERE sender_id = ? AND engaged = 0 AND sent_at > ?
       ORDER BY sent_at DESC LIMIT 1`,
    ).get(senderId, cutoff) as { id: string; sent_at: number } | undefined;

    if (!row) return false;

    const timeToEngage = engagedAt - (row.sent_at as number);
    this.db.prepare(
      `UPDATE proactive_outcomes SET engaged = 1, engaged_at = ?, response_quality = ?, time_to_engage_ms = ?
       WHERE id = ?`,
    ).run(engagedAt, quality, timeToEngage, row.id);
    return true;
  }

  getCategoryRates(senderId: string, windowDays = 30): CategoryRate[] {
    const cutoff = Date.now() - windowDays * 86_400_000;
    const rows = this.db.prepare(
      `SELECT category,
              COUNT(*) as count,
              SUM(engaged) as responded,
              AVG(CASE WHEN engaged = 1 THEN time_to_engage_ms END) as avg_response_ms
       FROM proactive_outcomes
       WHERE sender_id = ? AND sent_at > ?
       GROUP BY category`,
    ).all(senderId, cutoff) as Record<string, unknown>[];

    return rows.map((r) => ({
      category: r["category"] as string,
      count: r["count"] as number,
      responded: (r["responded"] as number) ?? 0,
      rate: ((r["responded"] as number) ?? 0) / ((r["count"] as number) || 1),
      avgResponseMs: r["avg_response_ms"] as number | null,
    }));
  }

  getTimingPatterns(senderId: string, windowDays = 30): TimingPattern {
    const cutoff = Date.now() - windowDays * 86_400_000;
    const rows = this.db.prepare(
      `SELECT day_of_week, hour_of_day,
              COUNT(*) as total,
              SUM(engaged) as engaged
       FROM proactive_outcomes
       WHERE sender_id = ? AND sent_at > ?
       GROUP BY day_of_week, hour_of_day
       HAVING total >= 2`,
    ).all(senderId, cutoff) as Record<string, unknown>[];

    const rateBySlot = rows.map((r) => ({
      day: r["day_of_week"] as number,
      hour: r["hour_of_day"] as number,
      rate: ((r["engaged"] as number) ?? 0) / ((r["total"] as number) || 1),
    }));

    const sorted = [...rateBySlot].sort((a, b) => b.rate - a.rate);
    const bestDays = [...new Set(sorted.filter((s) => s.rate >= 0.5).map((s) => s.day))];
    const bestHours = [...new Set(sorted.filter((s) => s.rate >= 0.5).map((s) => s.hour))];
    const worstDays = [...new Set(sorted.filter((s) => s.rate < 0.2).map((s) => s.day))];
    const worstHours = [...new Set(sorted.filter((s) => s.rate < 0.2).map((s) => s.hour))];

    return { bestDays, bestHours, worstDays, worstHours };
  }

  getOutcome(id: string): ProactiveOutcome | null {
    const row = this.db.prepare("SELECT * FROM proactive_outcomes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toOutcome(row) : null;
  }

  private toOutcome(row: Record<string, unknown>): ProactiveOutcome {
    return {
      id: row["id"] as string,
      intentId: row["intent_id"] as string,
      senderId: row["sender_id"] as string,
      channelId: row["channel_id"] as string,
      category: row["category"] as string,
      sentAt: row["sent_at"] as number,
      engaged: !!(row["engaged"] as number),
      engagedAt: row["engaged_at"] as number | null,
      responseQuality: row["response_quality"] as ProactiveOutcome["responseQuality"],
      timeToEngageMs: row["time_to_engage_ms"] as number | null,
      dayOfWeek: row["day_of_week"] as number,
      hourOfDay: row["hour_of_day"] as number,
      createdAt: row["created_at"] as number,
    };
  }
}
