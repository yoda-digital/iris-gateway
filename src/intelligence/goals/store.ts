import type Database from "better-sqlite3";
import type { VaultDB } from "../../vault/db.js";
import { randomUUID } from "node:crypto";
import type { Goal, GoalStatus } from "../types.js";

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS goals (
  id               TEXT PRIMARY KEY,
  sender_id        TEXT NOT NULL,
  channel_id       TEXT NOT NULL,
  arc_id           TEXT,
  description      TEXT NOT NULL,
  status           TEXT DEFAULT 'active',
  success_criteria TEXT,
  progress_notes   TEXT DEFAULT '[]',
  next_action      TEXT,
  next_action_due  INTEGER,
  priority         INTEGER DEFAULT 50,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  completed_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_goals_sender ON goals(sender_id, status);
CREATE INDEX IF NOT EXISTS idx_goals_due ON goals(next_action_due) WHERE status = 'active';`;

export class GoalsStore {
  private readonly db: Database.Database;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
    this.db.exec(SCHEMA_SQL);
  }

  // ── Goals ──

  createGoal(params: {
    senderId: string;
    channelId: string;
    description: string;
    arcId?: string;
    successCriteria?: string;
    nextAction?: string;
    nextActionDue?: number;
    priority?: number;
  }): Goal {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO goals (id, sender_id, channel_id, arc_id, description, status, success_criteria, progress_notes, next_action, next_action_due, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, '[]', ?, ?, ?, ?, ?)`,
    ).run(
      id, params.senderId, params.channelId, params.arcId ?? null,
      params.description, params.successCriteria ?? null,
      params.nextAction ?? null, params.nextActionDue ?? null,
      params.priority ?? 50, now, now,
    );
    return this.getGoal(id)!;
  }

  getGoal(id: string): Goal | null {
    const row = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toGoal(row) : null;
  }

  getActiveGoals(senderId: string): Goal[] {
    const rows = this.db.prepare(
      "SELECT * FROM goals WHERE sender_id = ? AND status = 'active' ORDER BY priority DESC, updated_at DESC",
    ).all(senderId) as Record<string, unknown>[];
    return rows.map((r) => this.toGoal(r));
  }

  getPausedGoals(senderId: string): Goal[] {
    const rows = this.db.prepare(
      "SELECT * FROM goals WHERE sender_id = ? AND status = 'paused' ORDER BY updated_at DESC",
    ).all(senderId) as Record<string, unknown>[];
    return rows.map((r) => this.toGoal(r));
  }

  getDueGoals(): Goal[] {
    const now = Date.now();
    const rows = this.db.prepare(
      "SELECT * FROM goals WHERE status = 'active' AND next_action_due IS NOT NULL AND next_action_due <= ? ORDER BY next_action_due ASC",
    ).all(now) as Record<string, unknown>[];
    return rows.map((r) => this.toGoal(r));
  }

  updateGoal(id: string, params: {
    progressNote?: string;
    nextAction?: string | null;
    nextActionDue?: number | null;
    priority?: number;
    status?: GoalStatus;
  }): Goal | null {
    const goal = this.getGoal(id);
    if (!goal) return null;

    const now = Date.now();

    if (params.progressNote) {
      const notes: Array<{ text: string; at: number }> = JSON.parse(goal.progressNotes);
      notes.push({ text: params.progressNote, at: now });
      this.db.prepare("UPDATE goals SET progress_notes = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(notes), now, id);
    }

    if (params.nextAction !== undefined) {
      this.db.prepare("UPDATE goals SET next_action = ?, updated_at = ? WHERE id = ?")
        .run(params.nextAction, now, id);
    }

    if (params.nextActionDue !== undefined) {
      this.db.prepare("UPDATE goals SET next_action_due = ?, updated_at = ? WHERE id = ?")
        .run(params.nextActionDue, now, id);
    }

    if (params.priority !== undefined) {
      this.db.prepare("UPDATE goals SET priority = ?, updated_at = ? WHERE id = ?")
        .run(params.priority, now, id);
    }

    if (params.status) {
      const completedAt = params.status === "completed" ? now : null;
      this.db.prepare("UPDATE goals SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?")
        .run(params.status, now, completedAt, id);
    }

    return this.getGoal(id);
  }

  getStaleGoals(defaultStaleDays = 30): Goal[] {
    const cutoff = Date.now() - defaultStaleDays * 86_400_000;
    const rows = this.db.prepare(
      "SELECT * FROM goals WHERE status = 'active' AND updated_at < ? ORDER BY updated_at ASC",
    ).all(cutoff) as Record<string, unknown>[];
    return rows.map((r) => this.toGoal(r));
  }

  private toGoal(row: Record<string, unknown>): Goal {
    return {
      id: row["id"] as string,
      senderId: row["sender_id"] as string,
      channelId: row["channel_id"] as string,
      arcId: row["arc_id"] as string | null,
      description: row["description"] as string,
      status: row["status"] as GoalStatus,
      successCriteria: row["success_criteria"] as string | null,
      progressNotes: row["progress_notes"] as string,
      nextAction: row["next_action"] as string | null,
      nextActionDue: row["next_action_due"] as number | null,
      priority: row["priority"] as number,
      createdAt: row["created_at"] as number,
      updatedAt: row["updated_at"] as number,
      completedAt: row["completed_at"] as number | null,
    };
  }
}
