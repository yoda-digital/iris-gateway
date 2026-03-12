import type { VaultDB } from "../vault/db.js";
import type { ProfileSignal, AddSignalParams } from "./types.js";

export class SignalStore {
  private readonly db;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile_signals (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id   TEXT NOT NULL,
        channel_id  TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        value       TEXT NOT NULL,
        confidence  REAL NOT NULL DEFAULT 0.5,
        observed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_signals_sender ON profile_signals(sender_id, signal_type);
    `);
  }

  addSignal(params: AddSignalParams): number {
    const result = this.db
      .prepare(
        `INSERT INTO profile_signals
         (sender_id, channel_id, signal_type, value, confidence, observed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.senderId,
        params.channelId,
        params.signalType,
        params.value,
        params.confidence ?? 0.5,
        Date.now(),
      );
    return Number(result.lastInsertRowid);
  }

  getSignals(senderId: string, channelId: string): ProfileSignal[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM profile_signals
         WHERE sender_id = ? AND channel_id = ?
         ORDER BY observed_at DESC, id DESC`,
      )
      .all(senderId, channelId) as Record<string, unknown>[];
    return rows.map((r) => this.toSignal(r));
  }

  getLatestSignal(senderId: string, channelId: string, signalType: string): ProfileSignal | null {
    const row = this.db
      .prepare(
        `SELECT * FROM profile_signals
         WHERE sender_id = ? AND channel_id = ? AND signal_type = ?
         ORDER BY observed_at DESC, id DESC LIMIT 1`,
      )
      .get(senderId, channelId, signalType) as Record<string, unknown> | undefined;
    return row ? this.toSignal(row) : null;
  }

  consolidate(senderId: string, channelId: string): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT signal_type, value FROM profile_signals
         WHERE sender_id = ? AND channel_id = ?
         AND confidence = (
           SELECT MAX(confidence) FROM profile_signals AS inner_ps
           WHERE inner_ps.sender_id = profile_signals.sender_id
             AND inner_ps.channel_id = profile_signals.channel_id
             AND inner_ps.signal_type = profile_signals.signal_type
         )
         GROUP BY signal_type`,
      )
      .all(senderId, channelId) as Record<string, unknown>[];

    const result = new Map<string, string>();
    for (const row of rows) {
      result.set(row["signal_type"] as string, row["value"] as string);
    }
    return result;
  }

  purgeOlderThan(retentionMs: number): number {
    const cutoff = Date.now() - retentionMs;
    const result = this.db
      .prepare("DELETE FROM profile_signals WHERE observed_at <= ?")
      .run(cutoff);
    return result.changes;
  }

  private toSignal(row: Record<string, unknown>): ProfileSignal {
    return {
      id: row["id"] as number,
      senderId: row["sender_id"] as string,
      channelId: row["channel_id"] as string,
      signalType: row["signal_type"] as string,
      value: row["value"] as string,
      confidence: row["confidence"] as number,
      observedAt: row["observed_at"] as number,
    };
  }
}
