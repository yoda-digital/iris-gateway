import { randomUUID } from "node:crypto";
import type { VaultDB } from "./db.js";
import type {
  Memory,
  UserProfile,
  AuditEntry,
  GovernanceLogEntry,
} from "./types.js";

export interface AddMemoryParams {
  sessionId: string;
  channelId?: string | null;
  senderId?: string | null;
  type: Memory["type"];
  content: string;
  source: Memory["source"];
  confidence?: number;
  expiresAt?: number | null;
}

export interface ListMemoriesParams {
  senderId?: string;
  channelId?: string;
  type?: Memory["type"];
  limit?: number;
}

export interface UpsertProfileParams {
  senderId: string;
  channelId: string;
  name?: string | null;
  timezone?: string | null;
  language?: string | null;
  preferences?: Record<string, unknown>;
}

export interface LogAuditParams {
  sessionId?: string | null;
  tool: string;
  args?: string | null;
  result?: string | null;
  durationMs?: number | null;
}

export interface LogGovernanceParams {
  sessionId?: string | null;
  tool?: string | null;
  ruleId?: string | null;
  action: GovernanceLogEntry["action"];
  reason?: string | null;
}

export class VaultStore {
  private readonly db;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
  }

  // ── Memories ──

  addMemory(params: AddMemoryParams): string {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO memories (id, session_id, channel_id, sender_id, type, content, source, confidence, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.sessionId,
        params.channelId ?? null,
        params.senderId ?? null,
        params.type,
        params.content,
        params.source,
        params.confidence ?? 1.0,
        now,
        now,
        params.expiresAt ?? null,
      );
    return id;
  }

  getMemory(id: string): Memory | null {
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.toMemory(row) : null;
  }

  listMemories(params: ListMemoriesParams): Memory[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.senderId) {
      conditions.push("sender_id = ?");
      values.push(params.senderId);
    }
    if (params.channelId) {
      conditions.push("channel_id = ?");
      values.push(params.channelId);
    }
    if (params.type) {
      conditions.push("type = ?");
      values.push(params.type);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 50;

    const rows = this.db
      .prepare(
        `SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...values, limit) as Record<string, unknown>[];
    return rows.map((r) => this.toMemory(r));
  }

  deleteMemory(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM memories WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  purgeExpired(): number {
    const result = this.db
      .prepare(
        "DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?",
      )
      .run(Date.now());
    return result.changes;
  }

  // ── Profiles ──

  upsertProfile(params: UpsertProfileParams): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO profiles (sender_id, channel_id, name, timezone, language, preferences, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sender_id, channel_id) DO UPDATE SET
           name = COALESCE(excluded.name, profiles.name),
           timezone = COALESCE(excluded.timezone, profiles.timezone),
           language = COALESCE(excluded.language, profiles.language),
           preferences = COALESCE(excluded.preferences, profiles.preferences),
           last_seen = excluded.last_seen`,
      )
      .run(
        params.senderId,
        params.channelId,
        params.name ?? null,
        params.timezone ?? null,
        params.language ?? null,
        JSON.stringify(params.preferences ?? {}),
        now,
        now,
      );
  }

  getProfile(senderId: string, channelId: string): UserProfile | null {
    const row = this.db
      .prepare(
        "SELECT * FROM profiles WHERE sender_id = ? AND channel_id = ?",
      )
      .get(senderId, channelId) as Record<string, unknown> | undefined;
    return row ? this.toProfile(row) : null;
  }

  // ── Audit Log ──

  logAudit(params: LogAuditParams): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (timestamp, session_id, tool, args, result, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Date.now(),
        params.sessionId ?? null,
        params.tool,
        params.args ?? null,
        params.result ?? null,
        params.durationMs ?? null,
      );
  }

  listAuditLog(params: { limit?: number }): AuditEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?")
      .all(params.limit ?? 50) as Record<string, unknown>[];
    return rows.map((r) => this.toAudit(r));
  }

  // ── Governance Log ──

  logGovernance(params: LogGovernanceParams): void {
    this.db
      .prepare(
        `INSERT INTO governance_log (timestamp, session_id, tool, rule_id, action, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Date.now(),
        params.sessionId ?? null,
        params.tool ?? null,
        params.ruleId ?? null,
        params.action,
        params.reason ?? null,
      );
  }

  listGovernanceLog(params: { limit?: number }): GovernanceLogEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM governance_log ORDER BY timestamp DESC LIMIT ?")
      .all(params.limit ?? 50) as Record<string, unknown>[];
    return rows.map((r) => this.toGovernanceLog(r));
  }

  // ── Mappers ──

  private toMemory(row: Record<string, unknown>): Memory {
    return {
      id: row["id"] as string,
      sessionId: row["session_id"] as string,
      channelId: (row["channel_id"] as string) ?? null,
      senderId: (row["sender_id"] as string) ?? null,
      type: row["type"] as Memory["type"],
      content: row["content"] as string,
      source: row["source"] as Memory["source"],
      confidence: row["confidence"] as number,
      createdAt: row["created_at"] as number,
      updatedAt: row["updated_at"] as number,
      expiresAt: (row["expires_at"] as number) ?? null,
    };
  }

  private toProfile(row: Record<string, unknown>): UserProfile {
    return {
      senderId: row["sender_id"] as string,
      channelId: row["channel_id"] as string,
      name: (row["name"] as string) ?? null,
      timezone: (row["timezone"] as string) ?? null,
      language: (row["language"] as string) ?? null,
      preferences: JSON.parse((row["preferences"] as string) || "{}"),
      firstSeen: row["first_seen"] as number,
      lastSeen: row["last_seen"] as number,
    };
  }

  private toAudit(row: Record<string, unknown>): AuditEntry {
    return {
      id: row["id"] as number,
      timestamp: row["timestamp"] as number,
      sessionId: (row["session_id"] as string) ?? null,
      tool: row["tool"] as string,
      args: (row["args"] as string) ?? null,
      result: (row["result"] as string) ?? null,
      durationMs: (row["duration_ms"] as number) ?? null,
    };
  }

  private toGovernanceLog(row: Record<string, unknown>): GovernanceLogEntry {
    return {
      id: row["id"] as number,
      timestamp: row["timestamp"] as number,
      sessionId: (row["session_id"] as string) ?? null,
      tool: (row["tool"] as string) ?? null,
      ruleId: (row["rule_id"] as string) ?? null,
      action: row["action"] as GovernanceLogEntry["action"],
      reason: (row["reason"] as string) ?? null,
    };
  }
}
