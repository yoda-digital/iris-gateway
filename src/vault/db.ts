import Database from "better-sqlite3";
import { join } from "node:path";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  channel_id  TEXT,
  sender_id   TEXT,
  type        TEXT NOT NULL CHECK(type IN ('fact','preference','event','insight')),
  content     TEXT NOT NULL,
  source      TEXT CHECK(source IN ('user_stated','extracted','system')),
  confidence  REAL DEFAULT 1.0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  expires_at  INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  type,
  content='memories',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, type) VALUES (new.rowid, new.content, new.type);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, type) VALUES('delete', old.rowid, old.content, old.type);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, type) VALUES('delete', old.rowid, old.content, old.type);
  INSERT INTO memories_fts(rowid, content, type) VALUES (new.rowid, new.content, new.type);
END;

CREATE TABLE IF NOT EXISTS profiles (
  sender_id   TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  name        TEXT,
  timezone    TEXT,
  language    TEXT,
  preferences TEXT DEFAULT '{}',
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  PRIMARY KEY (sender_id, channel_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   INTEGER NOT NULL,
  session_id  TEXT,
  tool        TEXT NOT NULL,
  args        TEXT,
  result      TEXT,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS governance_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   INTEGER NOT NULL,
  session_id  TEXT,
  tool        TEXT,
  rule_id     TEXT,
  action      TEXT CHECK(action IN ('allowed','blocked','modified')),
  reason      TEXT
);

CREATE TABLE IF NOT EXISTS usage_log (
  id          TEXT PRIMARY KEY,
  timestamp   INTEGER NOT NULL,
  session_id  TEXT,
  sender_id   TEXT,
  channel_id  TEXT,
  model_id    TEXT,
  provider_id TEXT,
  tokens_input    INTEGER DEFAULT 0,
  tokens_output   INTEGER DEFAULT 0,
  tokens_reasoning INTEGER DEFAULT 0,
  tokens_cache_read  INTEGER DEFAULT 0,
  tokens_cache_write INTEGER DEFAULT 0,
  cost_usd    REAL DEFAULT 0,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_usage_sender ON usage_log(sender_id);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_log(timestamp);
`;

export class VaultDB {
  private db: Database.Database;

  constructor(stateDir: string) {
    this.db = new Database(join(stateDir, "vault.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
  }

  raw(): Database.Database {
    return this.db;
  }

  isOpen(): boolean {
    return this.db.open;
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }
}
