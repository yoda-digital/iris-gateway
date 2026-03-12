import type Database from "better-sqlite3";
import type { VaultDB } from "../../vault/db.js";
import { randomUUID } from "node:crypto";
import type { DerivedSignal, InferenceLogEntry } from "../types.js";

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS derived_signals (
  id          TEXT PRIMARY KEY,
  sender_id   TEXT NOT NULL,
  channel_id  TEXT,
  signal_type TEXT NOT NULL,
  value       TEXT NOT NULL,
  confidence  REAL DEFAULT 0.5,
  evidence    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  expires_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_derived_sender ON derived_signals(sender_id, signal_type);

CREATE TABLE IF NOT EXISTS inference_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id     TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  result      TEXT,
  details     TEXT,
  executed_at INTEGER NOT NULL
);`;

export class InferenceStore {
  private readonly db: Database.Database;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
    this.db.exec(SCHEMA_SQL);
  }

  // ── Derived Signals ──

  writeDerivedSignal(params: {
    senderId: string;
    channelId?: string | null;
    signalType: string;
    value: string;
    confidence?: number;
    evidence?: string | null;
    expiresAt?: number | null;
  }): DerivedSignal {
    const now = Date.now();
    const existing = this.db
      .prepare("SELECT id FROM derived_signals WHERE sender_id = ? AND signal_type = ? AND (channel_id = ? OR (channel_id IS NULL AND ? IS NULL))")
      .get(params.senderId, params.signalType, params.channelId ?? null, params.channelId ?? null) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(
        `UPDATE derived_signals SET value = ?, confidence = ?, evidence = ?, updated_at = ?, expires_at = ?
         WHERE id = ?`,
      ).run(
        params.value,
        params.confidence ?? 0.5,
        params.evidence ?? null,
        now,
        params.expiresAt ?? null,
        existing.id,
      );
      return this.getDerivedSignal(existing.id)!;
    }

    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO derived_signals (id, sender_id, channel_id, signal_type, value, confidence, evidence, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      params.senderId,
      params.channelId ?? null,
      params.signalType,
      params.value,
      params.confidence ?? 0.5,
      params.evidence ?? null,
      now,
      now,
      params.expiresAt ?? null,
    );
    return this.getDerivedSignal(id)!;
  }

  getDerivedSignal(id: string): DerivedSignal | null {
    const row = this.db.prepare("SELECT * FROM derived_signals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toDerivedSignal(row) : null;
  }

  getDerivedSignals(senderId: string, signalType?: string): DerivedSignal[] {
    const query = signalType
      ? "SELECT * FROM derived_signals WHERE sender_id = ? AND signal_type = ? ORDER BY updated_at DESC"
      : "SELECT * FROM derived_signals WHERE sender_id = ? ORDER BY updated_at DESC";
    const args = signalType ? [senderId, signalType] : [senderId];
    const rows = this.db.prepare(query).all(...args) as Record<string, unknown>[];
    return rows.map((r) => this.toDerivedSignal(r));
  }

  logInference(entry: InferenceLogEntry): void {
    this.db.prepare(
      "INSERT INTO inference_log (rule_id, sender_id, result, details, executed_at) VALUES (?, ?, ?, ?, ?)",
    ).run(entry.ruleId, entry.senderId, entry.result, entry.details, entry.executedAt);
  }

  getLastInferenceRun(ruleId: string, senderId: string): number | null {
    const row = this.db
      .prepare("SELECT executed_at FROM inference_log WHERE rule_id = ? AND sender_id = ? ORDER BY executed_at DESC LIMIT 1")
      .get(ruleId, senderId) as { executed_at: number } | undefined;
    return row?.executed_at ?? null;
  }

  private toDerivedSignal(row: Record<string, unknown>): DerivedSignal {
    return {
      id: row["id"] as string,
      senderId: row["sender_id"] as string,
      channelId: row["channel_id"] as string | null,
      signalType: row["signal_type"] as string,
      value: row["value"] as string,
      confidence: row["confidence"] as number,
      evidence: row["evidence"] as string | null,
      createdAt: row["created_at"] as number,
      updatedAt: row["updated_at"] as number,
      expiresAt: row["expires_at"] as number | null,
    };
  }
}
