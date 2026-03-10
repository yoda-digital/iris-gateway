import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

const LOCK_TTL_MS = 10_000; // 10 s — instance must renew before this expires
const RENEW_INTERVAL_MS = 4_000; // renew every 4 s (2.5× safety margin)

export type LeaderChangeHandler = (isLeader: boolean) => void;

/**
 * Coordinates multiple iris-gateway instances sharing a single SQLite file.
 *
 * - Each instance gets a unique ID (IRIS_INSTANCE_ID env var or auto UUID).
 * - Leader election uses a single-row `instance_locks` table with a TTL.
 * - Only the leader runs singleton operations (cron, intelligence sweep, proactive engine).
 * - Session affinity is advisory: consumers may use `instanceId` as a routing hint.
 */
export class InstanceCoordinator {
  readonly instanceId: string;
  private db: Database.Database;
  private isLeader = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly handlers: LeaderChangeHandler[] = [];

  constructor(db: Database.Database) {
    this.instanceId =
      process.env["IRIS_INSTANCE_ID"] ?? randomUUID();
    this.db = db;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS instance_locks (
        lock_name   TEXT PRIMARY KEY,
        holder_id   TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS instance_registry (
        instance_id TEXT PRIMARY KEY,
        last_seen   INTEGER NOT NULL
      );
    `);
  }

  /** Start heartbeat loop; attempt leader election immediately. */
  start(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), RENEW_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Release lock if we hold it
    try {
      this.db
        .prepare(
          "DELETE FROM instance_locks WHERE lock_name = 'leader' AND holder_id = ?"
        )
        .run(this.instanceId);
    } catch {
      // best-effort
    }
    if (this.isLeader) {
      this.setLeader(false);
    }
  }

  get leader(): boolean {
    return this.isLeader;
  }

  onLeaderChange(handler: LeaderChangeHandler): void {
    this.handlers.push(handler);
  }

  private tick(): void {
    const now = Date.now();
    // Update presence
    this.db
      .prepare(
        "INSERT OR REPLACE INTO instance_registry(instance_id, last_seen) VALUES (?, ?)"
      )
      .run(this.instanceId, now);

    // Attempt to acquire or renew leader lock
    const newLeader = this.tryAcquire(now);
    if (newLeader !== this.isLeader) {
      this.setLeader(newLeader);
    }
  }

  private tryAcquire(now: number): boolean {
    const expiresAt = now + LOCK_TTL_MS;

    // Try to insert (acquire) or update (renew) atomically
    this.db
      .prepare(
        `INSERT INTO instance_locks(lock_name, holder_id, acquired_at, expires_at)
         VALUES ('leader', ?, ?, ?)
         ON CONFLICT(lock_name) DO UPDATE SET
           holder_id   = CASE WHEN expires_at < ? OR holder_id = ? THEN excluded.holder_id ELSE holder_id END,
           acquired_at = CASE WHEN expires_at < ? OR holder_id = ? THEN excluded.acquired_at ELSE acquired_at END,
           expires_at  = CASE WHEN expires_at < ? OR holder_id = ? THEN excluded.expires_at ELSE expires_at END`
      )
      .run(
        this.instanceId, now, expiresAt,
        now, this.instanceId,
        now, this.instanceId,
        now, this.instanceId
      );

    // Check if we actually hold the lock now
    const row = this.db
      .prepare("SELECT holder_id FROM instance_locks WHERE lock_name = 'leader'")
      .get() as { holder_id: string } | undefined;

    return row?.holder_id === this.instanceId;
  }

  private setLeader(value: boolean): void {
    this.isLeader = value;
    for (const h of this.handlers) {
      try { h(value); } catch { /* ignore */ }
    }
  }

  /** Returns IDs of instances seen within the last 30 s. */
  activeInstances(): string[] {
    if (!this.db) return [this.instanceId];
    const rows = this.db
      .prepare(
        "SELECT instance_id FROM instance_registry WHERE last_seen > ? ORDER BY last_seen DESC"
      )
      .all(Date.now() - 30_000) as Array<{ instance_id: string }>;
    return rows.map((r) => r.instance_id);
  }
}
