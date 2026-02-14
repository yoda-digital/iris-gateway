import type { VaultDB } from "../vault/db.js";
import type { HeartbeatLogEntry, HeartbeatActionEntry } from "./types.js";

const HEARTBEAT_SCHEMA = `
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL, status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL, details TEXT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_heartbeat_component ON heartbeat_log(component, checked_at);

CREATE TABLE IF NOT EXISTS heartbeat_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL, action TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0, error TEXT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  executed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_component ON heartbeat_actions(component, executed_at);

CREATE TABLE IF NOT EXISTS heartbeat_dedup (
  component TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'default',
  last_alert_text TEXT NOT NULL,
  last_sent_at INTEGER NOT NULL,
  PRIMARY KEY (component, agent_id)
);
`;

interface LogCheckParams {
  readonly component: string;
  readonly status: string;
  readonly latencyMs: number;
  readonly details?: string;
  readonly agentId?: string;
}

interface LogActionParams {
  readonly component: string;
  readonly action: string;
  readonly success: boolean;
  readonly error?: string;
  readonly agentId?: string;
}

export class HeartbeatStore {
  private readonly db;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
    this.db.exec(HEARTBEAT_SCHEMA);
  }

  logCheck(params: LogCheckParams): void {
    this.db
      .prepare(
        `INSERT INTO heartbeat_log (component, status, latency_ms, details, agent_id, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.component,
        params.status,
        params.latencyMs,
        params.details ?? null,
        params.agentId ?? "default",
        Date.now(),
      );
  }

  logAction(params: LogActionParams): void {
    this.db
      .prepare(
        `INSERT INTO heartbeat_actions (component, action, success, error, agent_id, executed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.component,
        params.action,
        params.success ? 1 : 0,
        params.error ?? null,
        params.agentId ?? "default",
        Date.now(),
      );
  }

  getRecentLogs(component: string, limit: number): HeartbeatLogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM heartbeat_log
         WHERE component = ?
         ORDER BY checked_at DESC LIMIT ?`,
      )
      .all(component, limit) as Record<string, unknown>[];
    return rows.map((r) => this.toLogEntry(r));
  }

  getRecentActions(component: string, limit: number): HeartbeatActionEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM heartbeat_actions
         WHERE component = ?
         ORDER BY executed_at DESC LIMIT ?`,
      )
      .all(component, limit) as Record<string, unknown>[];
    return rows.map((r) => this.toActionEntry(r));
  }

  getLatestStatus(): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT component, status FROM heartbeat_log
         WHERE checked_at = (
           SELECT MAX(checked_at) FROM heartbeat_log AS hl
           WHERE hl.component = heartbeat_log.component
         )`,
      )
      .all() as Record<string, unknown>[];

    const result = new Map<string, string>();
    for (const row of rows) {
      result.set(row["component"] as string, row["status"] as string);
    }
    return result;
  }

  purgeOlderThan(retentionMs: number): number {
    const cutoff = Date.now() - retentionMs;
    const logs = this.db
      .prepare("DELETE FROM heartbeat_log WHERE checked_at <= ?")
      .run(cutoff);
    const actions = this.db
      .prepare("DELETE FROM heartbeat_actions WHERE executed_at <= ?")
      .run(cutoff);
    return logs.changes + actions.changes;
  }

  isDuplicate(component: string, agentId: string, text: string, windowMs: number): boolean {
    const row = this.db
      .prepare(
        `SELECT last_alert_text, last_sent_at FROM heartbeat_dedup
         WHERE component = ? AND agent_id = ?`,
      )
      .get(component, agentId) as { last_alert_text: string; last_sent_at: number } | undefined;
    if (!row) return false;
    if (row.last_alert_text.trim() !== text.trim()) return false;
    return Date.now() - row.last_sent_at < windowMs;
  }

  recordAlert(component: string, agentId: string, text: string): void {
    this.db
      .prepare(
        `INSERT INTO heartbeat_dedup (component, agent_id, last_alert_text, last_sent_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(component, agent_id)
         DO UPDATE SET last_alert_text = excluded.last_alert_text, last_sent_at = excluded.last_sent_at`,
      )
      .run(component, agentId, text.trim(), Date.now());
  }

  // ── Row mappers ──

  private toLogEntry(row: Record<string, unknown>): HeartbeatLogEntry {
    return {
      id: row["id"] as number,
      component: row["component"] as string,
      status: row["status"] as string,
      latencyMs: row["latency_ms"] as number,
      details: (row["details"] as string) ?? null,
      checkedAt: row["checked_at"] as number,
    };
  }

  private toActionEntry(row: Record<string, unknown>): HeartbeatActionEntry {
    return {
      id: row["id"] as number,
      component: row["component"] as string,
      action: row["action"] as string,
      success: (row["success"] as number) === 1,
      error: (row["error"] as string) ?? null,
      executedAt: row["executed_at"] as number,
    };
  }
}
