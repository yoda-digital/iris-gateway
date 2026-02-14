import type Database from "better-sqlite3";
import type { VaultDB } from "../vault/db.js";
import { randomUUID } from "node:crypto";
import type {
  DerivedSignal,
  InferenceLogEntry,
  ProactiveOutcome,
  CategoryRate,
  TimingPattern,
  MemoryArc,
  ArcEntry,
  ArcStatus,
  Goal,
  GoalStatus,
} from "./types.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS derived_signals (
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
);

CREATE TABLE IF NOT EXISTS proactive_outcomes (
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
CREATE INDEX IF NOT EXISTS idx_outcomes_sender_time ON proactive_outcomes(sender_id, sent_at);

CREATE TABLE IF NOT EXISTS memory_arcs (
  id              TEXT PRIMARY KEY,
  sender_id       TEXT NOT NULL,
  title           TEXT NOT NULL,
  status          TEXT DEFAULT 'active',
  summary         TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  resolved_at     INTEGER,
  stale_after_days INTEGER DEFAULT 14
);
CREATE INDEX IF NOT EXISTS idx_arcs_sender ON memory_arcs(sender_id, status);

CREATE TABLE IF NOT EXISTS arc_entries (
  id          TEXT PRIMARY KEY,
  arc_id      TEXT NOT NULL,
  content     TEXT NOT NULL,
  source      TEXT DEFAULT 'conversation',
  memory_id   TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arc_entries ON arc_entries(arc_id, created_at);

CREATE TABLE IF NOT EXISTS goals (
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
CREATE INDEX IF NOT EXISTS idx_goals_due ON goals(next_action_due) WHERE status = 'active';
`;

export class IntelligenceStore {
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

  // ── Memory Arcs ──

  createArc(params: {
    senderId: string;
    title: string;
    summary?: string;
    staleDays?: number;
  }): MemoryArc {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO memory_arcs (id, sender_id, title, status, summary, created_at, updated_at, stale_after_days)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).run(id, params.senderId, params.title, params.summary ?? null, now, now, params.staleDays ?? 14);
    return this.getArc(id)!;
  }

  addArcEntry(params: {
    arcId: string;
    content: string;
    source?: "conversation" | "compaction" | "proactive" | "tool";
    memoryId?: string;
  }): ArcEntry {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO arc_entries (id, arc_id, content, source, memory_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, params.arcId, params.content, params.source ?? "conversation", params.memoryId ?? null, now);

    // Update arc timestamp and summary
    this.db.prepare(
      "UPDATE memory_arcs SET updated_at = ?, summary = ? WHERE id = ?",
    ).run(now, params.content.substring(0, 200), params.arcId);

    return this.getArcEntry(id)!;
  }

  getArc(id: string): MemoryArc | null {
    const row = this.db.prepare("SELECT * FROM memory_arcs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toArc(row) : null;
  }

  getActiveArcs(senderId: string): MemoryArc[] {
    const rows = this.db.prepare(
      "SELECT * FROM memory_arcs WHERE sender_id = ? AND status = 'active' ORDER BY updated_at DESC",
    ).all(senderId) as Record<string, unknown>[];
    return rows.map((r) => this.toArc(r));
  }

  getArcsBySender(senderId: string): MemoryArc[] {
    const rows = this.db.prepare(
      "SELECT * FROM memory_arcs WHERE sender_id = ? ORDER BY updated_at DESC",
    ).all(senderId) as Record<string, unknown>[];
    return rows.map((r) => this.toArc(r));
  }

  getArcEntries(arcId: string): ArcEntry[] {
    const rows = this.db.prepare(
      "SELECT * FROM arc_entries WHERE arc_id = ? ORDER BY created_at ASC",
    ).all(arcId) as Record<string, unknown>[];
    return rows.map((r) => this.toArcEntry(r));
  }

  getStaleArcs(defaultStaleDays = 14): MemoryArc[] {
    const now = Date.now();
    const rows = this.db.prepare(
      `SELECT * FROM memory_arcs
       WHERE status = 'active'
         AND updated_at < (? - stale_after_days * 86400000)
       ORDER BY updated_at ASC`,
    ).all(now) as Record<string, unknown>[];
    return rows.map((r) => this.toArc(r));
  }

  updateArcStatus(arcId: string, status: ArcStatus): void {
    const now = Date.now();
    const resolvedAt = status === "resolved" ? now : null;
    this.db.prepare(
      "UPDATE memory_arcs SET status = ?, updated_at = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?",
    ).run(status, now, resolvedAt, arcId);
  }

  findArcByKeywords(senderId: string, keywords: string[]): MemoryArc | null {
    const arcs = this.getActiveArcs(senderId);
    for (const arc of arcs) {
      const titleWords = arc.title.toLowerCase().split(/[\s\-_]+/);
      const overlap = keywords.filter((kw) => titleWords.includes(kw.toLowerCase()));
      if (overlap.length >= 2) return arc;
    }
    return null;
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

  // ── Row mappers ──

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

  private toArc(row: Record<string, unknown>): MemoryArc {
    return {
      id: row["id"] as string,
      senderId: row["sender_id"] as string,
      title: row["title"] as string,
      status: row["status"] as ArcStatus,
      summary: row["summary"] as string | null,
      createdAt: row["created_at"] as number,
      updatedAt: row["updated_at"] as number,
      resolvedAt: row["resolved_at"] as number | null,
      staleDays: row["stale_after_days"] as number,
    };
  }

  private toArcEntry(row: Record<string, unknown>): ArcEntry {
    return {
      id: row["id"] as string,
      arcId: row["arc_id"] as string,
      content: row["content"] as string,
      source: row["source"] as ArcEntry["source"],
      memoryId: row["memory_id"] as string | null,
      createdAt: row["created_at"] as number,
    };
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

  private getArcEntry(id: string): ArcEntry | null {
    const row = this.db.prepare("SELECT * FROM arc_entries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toArcEntry(row) : null;
  }
}
