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
  duration_ms INTEGER,
  turn_id     TEXT,
  step_index  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_log_session_id  ON audit_log (session_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_turn_id     ON audit_log (turn_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp   ON audit_log (timestamp DESC);

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

CREATE TABLE IF NOT EXISTS proactive_intents (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  what        TEXT NOT NULL,
  why         TEXT,
  category    TEXT,
  confidence  REAL DEFAULT 0.8,
  execute_at  INTEGER NOT NULL,
  executed_at INTEGER,
  result      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proactive_intents_pending
  ON proactive_intents(execute_at) WHERE executed_at IS NULL;

CREATE TABLE IF NOT EXISTS proactive_triggers (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('dormant_user','unanswered','engagement_drop','external')),
  channel_id  TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  context     TEXT NOT NULL,
  execute_at  INTEGER NOT NULL,
  executed_at INTEGER,
  result      TEXT
);
CREATE INDEX IF NOT EXISTS idx_proactive_triggers_pending
  ON proactive_triggers(execute_at) WHERE executed_at IS NULL;

CREATE TABLE IF NOT EXISTS proactive_log (
  id          TEXT PRIMARY KEY,
  sender_id   TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('intent','trigger')),
  source_id   TEXT NOT NULL,
  sent_at     INTEGER NOT NULL,
  engaged     INTEGER DEFAULT 0,
  engagement_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_proactive_log_sender
  ON proactive_log(sender_id, channel_id, sent_at);
`;

export class VaultDB {
  private db: Database.Database;

  constructor(stateDir: string) {
    this.db = new Database(join(stateDir, "vault.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  /**
   * Forward-only migrations for existing databases.
   * Each migration is idempotent (checks before altering).
   */
  private migrate(): void {
    const piColumns = this.db
      .prepare("PRAGMA table_info(proactive_intents)")
      .all() as Array<{ name: string }>;
    if (piColumns.length > 0 && !piColumns.some((c) => c.name === "category")) {
      this.db.exec("ALTER TABLE proactive_intents ADD COLUMN category TEXT");
    }

    // audit_log: add turn_id and step_index for trace grouping
    const auditColumns = this.db
      .prepare("PRAGMA table_info(audit_log)")
      .all() as Array<{ name: string }>;
    if (auditColumns.length > 0) {
      if (!auditColumns.some((c) => c.name === "turn_id")) {
        this.db.exec("ALTER TABLE audit_log ADD COLUMN turn_id TEXT");
      }
      if (!auditColumns.some((c) => c.name === "step_index")) {
        this.db.exec("ALTER TABLE audit_log ADD COLUMN step_index INTEGER");
      }
    }
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

/**
 * Standalone migration helper for unit tests and external tooling.
 * Also called automatically by VaultDB constructor.
 */
export function runAuditLogMigration(db: Database.Database): void {
  const cols = (db.prepare("PRAGMA table_info(audit_log)").all() as Array<{name:string}>).map(c => c.name);
  if (cols.length === 0) return; // table doesn't exist yet
  if (!cols.includes("turn_id")) db.exec("ALTER TABLE audit_log ADD COLUMN turn_id TEXT");
  if (!cols.includes("step_index")) db.exec("ALTER TABLE audit_log ADD COLUMN step_index INTEGER");
}
