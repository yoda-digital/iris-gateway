import { randomUUID } from "node:crypto";
import type { VaultDB } from "../vault/db.js";
import type { UsageRecord, UsageSummary, UsageBreakdown } from "./types.js";

export class UsageTracker {
  constructor(private readonly db: VaultDB) {}

  record(entry: UsageRecord): string {
    const id = randomUUID();
    const timestamp = Date.now();
    this.db.raw().prepare(`
      INSERT INTO usage_log (id, timestamp, session_id, sender_id, channel_id,
        model_id, provider_id, tokens_input, tokens_output, tokens_reasoning,
        tokens_cache_read, tokens_cache_write, cost_usd, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, timestamp, entry.sessionId, entry.senderId, entry.channelId,
      entry.modelId, entry.providerId, entry.tokensInput, entry.tokensOutput,
      entry.tokensReasoning, entry.tokensCacheRead, entry.tokensCacheWrite,
      entry.costUsd, entry.durationMs,
    );
    return id;
  }

  summarize(opts: { senderId?: string; since?: number; until?: number }): UsageSummary {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.senderId) {
      conditions.push("sender_id = ?");
      params.push(opts.senderId);
    }
    if (opts.since) {
      conditions.push("timestamp >= ?");
      params.push(opts.since);
    }
    if (opts.until) {
      conditions.push("timestamp <= ?");
      params.push(opts.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const row = this.db.raw().prepare(`
      SELECT
        COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COUNT(*) as message_count
      FROM usage_log ${where}
    `).get(...params) as { total_tokens: number; total_cost: number; message_count: number };

    const dailyRows = this.db.raw().prepare(`
      SELECT
        date(timestamp / 1000, 'unixepoch') as date,
        SUM(tokens_input + tokens_output + tokens_reasoning) as tokens,
        SUM(cost_usd) as cost,
        COUNT(*) as messages
      FROM usage_log ${where}
      GROUP BY date(timestamp / 1000, 'unixepoch')
      ORDER BY date DESC
      LIMIT 30
    `).all(...params) as Array<{ date: string; tokens: number; cost: number; messages: number }>;

    return {
      totalTokens: row.total_tokens,
      totalCost: row.total_cost,
      messageCount: row.message_count,
      period: opts.since ? `since ${new Date(opts.since).toISOString()}` : "all time",
      breakdown: dailyRows.map((r) => ({
        date: r.date,
        tokens: r.tokens,
        cost: r.cost,
        messages: r.messages,
      })),
    };
  }
}
