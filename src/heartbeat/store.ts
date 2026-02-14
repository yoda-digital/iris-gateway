import type { VaultDB } from "../vault/db.js";
import type { HeartbeatLogEntry, HeartbeatActionEntry } from "./types.js";

const HEARTBEAT_SCHEMA = `
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL, status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL, details TEXT,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_heartbeat_component ON heartbeat_log(component, checked_at);

CREATE TABLE IF NOT EXISTS heartbeat_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL, action TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0, error TEXT,
  executed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_component ON heartbeat_actions(component, executed_at);
`;

interface LogCheckParams {
  readonly component: string;
  readonly status: string;
  readonly latencyMs: number;
  readonly details?: string;
}

interface LogActionParams {
  readonly component: string;
  readonly action: string;
  readonly success: boolean;
  readonly error?: string;
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
        `INSERT INTO heartbeat_log (component, status, latency_ms, details, checked_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        params.component,
        params.status,
        params.latencyMs,
        params.details ?? null,
        Date.now(),
      );
  }

  logAction(params: LogActionParams): void {
    this.db
      .prepare(
        `INSERT INTO heartbeat_actions (component, action, success, error, executed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        params.component,
        params.action,
        params.success ? 1 : 0,
        params.error ?? null,
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
