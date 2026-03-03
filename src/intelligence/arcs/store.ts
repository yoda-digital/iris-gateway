import type Database from "better-sqlite3";
import type { VaultDB } from "../../vault/db.js";
import { randomUUID } from "node:crypto";
import type { MemoryArc, ArcEntry, ArcStatus } from "../types.js";

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS memory_arcs (
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
CREATE INDEX IF NOT EXISTS idx_arc_entries ON arc_entries(arc_id, created_at);`;

export class ArcsStore {
  private readonly db: Database.Database;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
    this.db.exec(SCHEMA_SQL);
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

  updateArcTitle(arcId: string, title: string): void {
    this.db.prepare(
      "UPDATE memory_arcs SET title = ?, updated_at = ? WHERE id = ?",
    ).run(title, Date.now(), arcId);
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

  private getArcEntry(id: string): ArcEntry | null {
    const row = this.db.prepare("SELECT * FROM arc_entries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toArcEntry(row) : null;
  }
}
