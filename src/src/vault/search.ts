import type { VaultDB } from "./db.js";
import type { Memory, MemoryType } from "./types.js";

export interface SearchParams {
  senderId?: string;
  channelId?: string;
  type?: MemoryType;
  limit?: number;
}

export class VaultSearch {
  private readonly db;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
  }

  search(query: string, params?: SearchParams): Memory[] {
    const limit = params?.limit ?? 10;

    if (!query.trim()) {
      return this.filteredList(params ?? {}, limit);
    }

    const conditions: string[] = [];
    const values: unknown[] = [query];

    if (params?.senderId) {
      conditions.push("m.sender_id = ?");
      values.push(params.senderId);
    }
    if (params?.channelId) {
      conditions.push("m.channel_id = ?");
      values.push(params.channelId);
    }
    if (params?.type) {
      conditions.push("m.type = ?");
      values.push(params.type);
    }

    const where =
      conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
    values.push(limit);

    const rows = this.db
      .prepare(
        `SELECT m.* FROM memories_fts fts
         JOIN memories m ON m.rowid = fts.rowid
         WHERE memories_fts MATCH ?
         ${where}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...values) as Record<string, unknown>[];

    return rows.map((r) => this.toMemory(r));
  }

  private filteredList(params: SearchParams, limit: number): Memory[] {
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
    values.push(limit);

    const rows = this.db
      .prepare(
        `SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...values) as Record<string, unknown>[];
    return rows.map((r) => this.toMemory(r));
  }

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
}
