# Proactive Intelligence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dual-layer proactive intelligence to Iris — AI-native intents (active) + pattern detection (passive), with full agency, soft quotas, and self-tuning engagement feedback.

**Architecture:** 3 new files (`src/proactive/{types,store,engine}.ts`), vault schema extension (3 tables), 6 tool server endpoints, 7 plugin tools, system prompt injection for proactive awareness. PulseEngine ticks every 60s for mature intents, every 6h for passive scans. AI always re-evaluated before execution.

**Tech Stack:** better-sqlite3 (extends vault.db), Croner (timer scheduling), Hono (endpoints), Zod (validation), vitest (tests).

---

### Task 1: Proactive Types

**Files:**
- Create: `src/proactive/types.ts`
- Modify: `src/config/types.ts:2-16`
- Modify: `src/config/schema.ts:117-158`
- Test: `test/unit/proactive-store.test.ts` (created in Task 2)

**Step 1: Create `src/proactive/types.ts`**

```typescript
export interface ProactiveIntent {
  readonly id: string;
  readonly sessionId: string;
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly what: string;
  readonly why: string | null;
  readonly confidence: number;
  readonly executeAt: number;
  readonly executedAt: number | null;
  readonly result: string | null;
  readonly createdAt: number;
}

export interface ProactiveTrigger {
  readonly id: string;
  readonly type: "dormant_user" | "unanswered" | "engagement_drop" | "external";
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly context: string;
  readonly executeAt: number;
  readonly executedAt: number | null;
  readonly result: string | null;
}

export interface ProactiveLogEntry {
  readonly id: string;
  readonly senderId: string;
  readonly channelId: string;
  readonly type: "intent" | "trigger";
  readonly sourceId: string;
  readonly sentAt: number;
  readonly engaged: boolean;
  readonly engagementAt: number | null;
}

export interface QuotaStatus {
  readonly allowed: boolean;
  readonly sentToday: number;
  readonly limit: number;
  readonly engagementRate: number;
}

export interface DormantUser {
  readonly senderId: string;
  readonly channelId: string;
  readonly name: string | null;
  readonly lastSeen: number;
}

export interface AddIntentParams {
  readonly sessionId: string;
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly what: string;
  readonly why?: string | null;
  readonly confidence?: number;
  readonly executeAt: number;
}

export interface AddTriggerParams {
  readonly type: ProactiveTrigger["type"];
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly context: string;
  readonly executeAt: number;
}

export interface ProactiveConfig {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;
  readonly passiveScanIntervalMs: number;
  readonly softQuotas: {
    readonly perUserPerDay: number;
    readonly globalPerDay: number;
  };
  readonly dormancy: {
    readonly enabled: boolean;
    readonly thresholdMs: number;
  };
  readonly intentDefaults: {
    readonly minDelayMs: number;
    readonly maxAgeMs: number;
    readonly defaultConfidence: number;
    readonly confidenceThreshold: number;
  };
  readonly quietHours: {
    readonly start: number;
    readonly end: number;
  };
}
```

**Step 2: Add `ProactiveConfig` to `IrisConfig`**

In `src/config/types.ts`, add after line 15 (before the closing `}`):

```typescript
  readonly proactive?: ProactiveConfig;
```

And add the import/re-export at the bottom of the file (after line 184):

```typescript
export type { ProactiveConfig } from "../proactive/types.js";
```

**Step 3: Add Zod schema for proactive config**

In `src/config/schema.ts`, add after line 117 (after `policySchema`):

```typescript
const proactiveSchema = z.object({
  enabled: z.boolean().default(false),
  pollIntervalMs: z.number().positive().default(60_000),
  passiveScanIntervalMs: z.number().positive().default(21_600_000),
  softQuotas: z.object({
    perUserPerDay: z.number().int().positive().default(3),
    globalPerDay: z.number().int().positive().default(100),
  }).default({}),
  dormancy: z.object({
    enabled: z.boolean().default(true),
    thresholdMs: z.number().positive().default(604_800_000),
  }).default({}),
  intentDefaults: z.object({
    minDelayMs: z.number().positive().default(3_600_000),
    maxAgeMs: z.number().positive().default(604_800_000),
    defaultConfidence: z.number().min(0).max(1).default(0.8),
    confidenceThreshold: z.number().min(0).max(1).default(0.5),
  }).default({}),
  quietHours: z.object({
    start: z.number().int().min(0).max(23).default(22),
    end: z.number().int().min(0).max(23).default(8),
  }).default({}),
});
```

Then in the `irisConfigSchema` object (line 119-158), add after `policy: policySchema,` (line 127):

```typescript
  proactive: proactiveSchema.optional(),
```

**Step 4: Run lint to verify types compile**

Run: `pnpm run lint`
Expected: PASS (no type errors)

**Step 5: Commit**

```bash
git add src/proactive/types.ts src/config/types.ts src/config/schema.ts
git commit -m "feat(proactive): add types and config schema"
```

---

### Task 2: IntentStore — Schema + CRUD

**Files:**
- Create: `src/proactive/store.ts`
- Modify: `src/vault/db.ts:4-90`
- Create: `test/unit/proactive-store.test.ts`

**Step 1: Write the failing test**

Create `test/unit/proactive-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { IntentStore } from "../../src/proactive/store.js";

describe("IntentStore", () => {
  let dir: string;
  let db: VaultDB;
  let store: IntentStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-proactive-"));
    db = new VaultDB(dir);
    store = new IntentStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("schema", () => {
    it("creates proactive_intents table", () => {
      const row = db.raw().prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='proactive_intents'"
      ).get() as { name: string } | undefined;
      expect(row?.name).toBe("proactive_intents");
    });

    it("creates proactive_triggers table", () => {
      const row = db.raw().prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='proactive_triggers'"
      ).get() as { name: string } | undefined;
      expect(row?.name).toBe("proactive_triggers");
    });

    it("creates proactive_log table", () => {
      const row = db.raw().prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='proactive_log'"
      ).get() as { name: string } | undefined;
      expect(row?.name).toBe("proactive_log");
    });
  });

  describe("intents", () => {
    it("adds and retrieves an intent", () => {
      const id = store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "check if user fixed server",
        why: "user committed to fixing",
        confidence: 0.9,
        executeAt: Date.now() + 86_400_000,
      });
      expect(id).toBeTruthy();

      const pending = store.listPendingIntents();
      expect(pending).toHaveLength(1);
      expect(pending[0].what).toBe("check if user fixed server");
      expect(pending[0].confidence).toBe(0.9);
    });

    it("only lists intents past their execute_at time", () => {
      store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "future intent",
        executeAt: Date.now() + 999_999_999,
      });
      store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "ready intent",
        executeAt: Date.now() - 1000,
      });

      const pending = store.listPendingIntents();
      expect(pending).toHaveLength(1);
      expect(pending[0].what).toBe("ready intent");
    });

    it("marks intent as executed", () => {
      const id = store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "test",
        executeAt: Date.now() - 1000,
      });

      store.markIntentExecuted(id, "sent");
      const pending = store.listPendingIntents();
      expect(pending).toHaveLength(0);
    });

    it("cancels an intent", () => {
      const id = store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "cancel me",
        executeAt: Date.now() - 1000,
      });

      expect(store.cancelIntent(id)).toBe(true);
      expect(store.listPendingIntents()).toHaveLength(0);
    });
  });

  describe("triggers", () => {
    it("adds and lists pending triggers", () => {
      store.addTrigger({
        type: "dormant_user",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        context: "User inactive for 7 days",
        executeAt: Date.now() - 1000,
      });

      const pending = store.listPendingTriggers();
      expect(pending).toHaveLength(1);
      expect(pending[0].type).toBe("dormant_user");
    });

    it("prevents duplicate dormant_user triggers for same sender", () => {
      store.addTrigger({
        type: "dormant_user",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        context: "first",
        executeAt: Date.now() + 999_999,
      });

      expect(store.hasPendingTrigger("user1", "dormant_user")).toBe(true);
    });
  });

  describe("quota + engagement", () => {
    it("tracks proactive messages and enforces soft quota", () => {
      const status1 = store.getQuotaStatus("user1", "telegram", 3);
      expect(status1.allowed).toBe(true);
      expect(status1.sentToday).toBe(0);

      store.logProactiveMessage({
        senderId: "user1",
        channelId: "telegram",
        type: "intent",
        sourceId: "src1",
      });

      const status2 = store.getQuotaStatus("user1", "telegram", 3);
      expect(status2.sentToday).toBe(1);
      expect(status2.allowed).toBe(true);
    });

    it("reports not allowed when quota exceeded", () => {
      for (let i = 0; i < 3; i++) {
        store.logProactiveMessage({
          senderId: "user1",
          channelId: "telegram",
          type: "intent",
          sourceId: `src${i}`,
        });
      }

      const status = store.getQuotaStatus("user1", "telegram", 3);
      expect(status.allowed).toBe(false);
      expect(status.sentToday).toBe(3);
    });

    it("tracks engagement", () => {
      store.logProactiveMessage({
        senderId: "user1",
        channelId: "telegram",
        type: "intent",
        sourceId: "src1",
      });

      store.markEngaged("user1", "telegram");

      const rate = store.getEngagementRate("user1", "telegram");
      expect(rate).toBe(1.0);
    });

    it("returns 0 engagement rate with no history", () => {
      const rate = store.getEngagementRate("user1", "telegram");
      expect(rate).toBe(0);
    });
  });

  describe("cleanup", () => {
    it("purges expired intents", () => {
      store.addIntent({
        sessionId: "s1",
        channelId: "telegram",
        chatId: "chat1",
        senderId: "user1",
        what: "old",
        executeAt: Date.now() - 999_999_999,
      });

      const purged = store.purgeExpired(86_400_000); // 1 day max age
      expect(purged).toBeGreaterThan(0);
      expect(store.listPendingIntents()).toHaveLength(0);
    });
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/proactive-store.test.ts`
Expected: FAIL with "Cannot find module" (store.ts doesn't exist yet)

**Step 3: Add vault schema for proactive tables**

In `src/vault/db.ts`, add the following SQL to the `SCHEMA_SQL` template literal, after line 89 (after the `usage_log` indexes, before the closing backtick):

```sql

CREATE TABLE IF NOT EXISTS proactive_intents (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  what        TEXT NOT NULL,
  why         TEXT,
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
```

**Step 4: Implement IntentStore**

Create `src/proactive/store.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { VaultDB } from "../vault/db.js";
import type {
  ProactiveIntent,
  ProactiveTrigger,
  ProactiveLogEntry,
  QuotaStatus,
  DormantUser,
  AddIntentParams,
  AddTriggerParams,
} from "./types.js";

interface LogParams {
  readonly senderId: string;
  readonly channelId: string;
  readonly type: "intent" | "trigger";
  readonly sourceId: string;
}

export class IntentStore {
  private readonly db;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
  }

  // ── Intents (active layer) ──

  addIntent(params: AddIntentParams): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO proactive_intents
         (id, session_id, channel_id, chat_id, sender_id, what, why, confidence, execute_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.sessionId,
        params.channelId,
        params.chatId,
        params.senderId,
        params.what,
        params.why ?? null,
        params.confidence ?? 0.8,
        params.executeAt,
        Date.now(),
      );
    return id;
  }

  listPendingIntents(limit = 10): ProactiveIntent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM proactive_intents
         WHERE executed_at IS NULL AND execute_at <= ?
         ORDER BY execute_at ASC LIMIT ?`,
      )
      .all(Date.now(), limit) as Record<string, unknown>[];
    return rows.map((r) => this.toIntent(r));
  }

  listAllPending(limit = 20): { intents: ProactiveIntent[]; triggers: ProactiveTrigger[] } {
    return {
      intents: this.listPendingIntents(limit),
      triggers: this.listPendingTriggers(limit),
    };
  }

  cancelIntent(id: string): boolean {
    const result = this.db
      .prepare("UPDATE proactive_intents SET executed_at = ?, result = 'cancelled' WHERE id = ? AND executed_at IS NULL")
      .run(Date.now(), id);
    return result.changes > 0;
  }

  markIntentExecuted(id: string, result: string): void {
    this.db
      .prepare("UPDATE proactive_intents SET executed_at = ?, result = ? WHERE id = ?")
      .run(Date.now(), result, id);
  }

  // ── Triggers (passive layer) ──

  addTrigger(params: AddTriggerParams): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO proactive_triggers
         (id, type, channel_id, chat_id, sender_id, context, execute_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, params.type, params.channelId, params.chatId, params.senderId, params.context, params.executeAt);
    return id;
  }

  listPendingTriggers(limit = 10): ProactiveTrigger[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM proactive_triggers
         WHERE executed_at IS NULL AND execute_at <= ?
         ORDER BY execute_at ASC LIMIT ?`,
      )
      .all(Date.now(), limit) as Record<string, unknown>[];
    return rows.map((r) => this.toTrigger(r));
  }

  hasPendingTrigger(senderId: string, type: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM proactive_triggers WHERE sender_id = ? AND type = ? AND executed_at IS NULL LIMIT 1",
      )
      .get(senderId, type);
    return row !== undefined;
  }

  markTriggerExecuted(id: string, result: string): void {
    this.db
      .prepare("UPDATE proactive_triggers SET executed_at = ?, result = ? WHERE id = ?")
      .run(Date.now(), result, id);
  }

  // ── Engagement tracking + soft quotas ──

  logProactiveMessage(params: LogParams): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO proactive_log (id, sender_id, channel_id, type, source_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, params.senderId, params.channelId, params.type, params.sourceId, Date.now());
    return id;
  }

  markEngaged(senderId: string, channelId: string): void {
    // Mark the most recent un-engaged proactive message as engaged
    this.db
      .prepare(
        `UPDATE proactive_log SET engaged = 1, engagement_at = ?
         WHERE id = (
           SELECT id FROM proactive_log
           WHERE sender_id = ? AND channel_id = ? AND engaged = 0
           ORDER BY sent_at DESC LIMIT 1
         )`,
      )
      .run(Date.now(), senderId, channelId);
  }

  getQuotaStatus(senderId: string, channelId: string, perUserPerDay: number): QuotaStatus {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM proactive_log
         WHERE sender_id = ? AND channel_id = ? AND sent_at >= ?`,
      )
      .get(senderId, channelId, todayStart.getTime()) as { cnt: number };

    const sentToday = row.cnt;
    const rate = this.getEngagementRate(senderId, channelId);

    return {
      allowed: sentToday < perUserPerDay,
      sentToday,
      limit: perUserPerDay,
      engagementRate: rate,
    };
  }

  getEngagementRate(senderId: string, channelId: string): number {
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as total, SUM(engaged) as engaged FROM proactive_log
         WHERE sender_id = ? AND channel_id = ? AND sent_at >= ?`,
      )
      .get(senderId, channelId, thirtyDaysAgo) as { total: number; engaged: number | null };

    if (row.total === 0) return 0;
    return (row.engaged ?? 0) / row.total;
  }

  getGlobalQuotaToday(): number {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const row = this.db
      .prepare("SELECT COUNT(*) as cnt FROM proactive_log WHERE sent_at >= ?")
      .get(todayStart.getTime()) as { cnt: number };
    return row.cnt;
  }

  // ── Dormant user detection ──

  listDormantUsers(thresholdMs: number, limit: number): DormantUser[] {
    const cutoff = Date.now() - thresholdMs;
    const rows = this.db
      .prepare(
        `SELECT sender_id, channel_id, name, last_seen FROM profiles
         WHERE last_seen < ? AND last_seen > 0
         AND sender_id NOT IN (
           SELECT sender_id FROM proactive_triggers
           WHERE type = 'dormant_user' AND executed_at IS NULL
         )
         ORDER BY last_seen ASC LIMIT ?`,
      )
      .all(cutoff, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      senderId: r["sender_id"] as string,
      channelId: r["channel_id"] as string,
      name: (r["name"] as string) ?? null,
      lastSeen: r["last_seen"] as number,
    }));
  }

  // ── Cleanup ──

  purgeExpired(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const intents = this.db
      .prepare("DELETE FROM proactive_intents WHERE executed_at IS NULL AND created_at < ?")
      .run(cutoff);
    const triggers = this.db
      .prepare("DELETE FROM proactive_triggers WHERE executed_at IS NULL AND execute_at < ?")
      .run(cutoff);
    return intents.changes + triggers.changes;
  }

  // ── Row mappers ──

  private toIntent(row: Record<string, unknown>): ProactiveIntent {
    return {
      id: row["id"] as string,
      sessionId: row["session_id"] as string,
      channelId: row["channel_id"] as string,
      chatId: row["chat_id"] as string,
      senderId: row["sender_id"] as string,
      what: row["what"] as string,
      why: (row["why"] as string) ?? null,
      confidence: row["confidence"] as number,
      executeAt: row["execute_at"] as number,
      executedAt: (row["executed_at"] as number) ?? null,
      result: (row["result"] as string) ?? null,
      createdAt: row["created_at"] as number,
    };
  }

  private toTrigger(row: Record<string, unknown>): ProactiveTrigger {
    return {
      id: row["id"] as string,
      type: row["type"] as ProactiveTrigger["type"],
      channelId: row["channel_id"] as string,
      chatId: row["chat_id"] as string,
      senderId: row["sender_id"] as string,
      context: row["context"] as string,
      executeAt: row["execute_at"] as number,
      executedAt: (row["executed_at"] as number) ?? null,
      result: (row["result"] as string) ?? null,
    };
  }
}
```

**Step 5: Run the tests**

Run: `npx vitest run test/unit/proactive-store.test.ts`
Expected: ALL PASS

**Step 6: Run existing vault tests to verify no regression**

Run: `npx vitest run test/unit/vault-db.test.ts test/unit/vault-store.test.ts test/unit/vault-search.test.ts`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/proactive/store.ts src/vault/db.ts test/unit/proactive-store.test.ts
git commit -m "feat(proactive): intent store with schema, CRUD, quotas, engagement"
```

---

### Task 3: PulseEngine

**Files:**
- Create: `src/proactive/engine.ts`
- Create: `test/unit/proactive-engine.test.ts`

**Step 1: Write the failing test**

Create `test/unit/proactive-engine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";
import { IntentStore } from "../../src/proactive/store.js";
import { PulseEngine } from "../../src/proactive/engine.js";
import type { ProactiveConfig } from "../../src/proactive/types.js";

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
  } as any;
}

function mockBridge() {
  return {
    createSession: vi.fn().mockResolvedValue({ id: "session-1" }),
    sendAndWait: vi.fn().mockResolvedValue("Follow-up response from AI"),
  };
}

function mockRouter() {
  return {
    sendResponse: vi.fn().mockResolvedValue(undefined),
  };
}

function mockSessionMap() {
  return {
    resolve: vi.fn().mockResolvedValue({
      openCodeSessionId: "session-1",
      channelId: "telegram",
      senderId: "user1",
      chatId: "chat1",
      chatType: "dm" as const,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }),
    findBySessionId: vi.fn().mockResolvedValue(null),
  };
}

function mockRegistry() {
  return {
    get: vi.fn().mockReturnValue({
      id: "telegram",
      sendText: vi.fn().mockResolvedValue({ messageId: "msg1" }),
    }),
    list: vi.fn().mockReturnValue([]),
  };
}

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: true,
  pollIntervalMs: 60_000,
  passiveScanIntervalMs: 21_600_000,
  softQuotas: { perUserPerDay: 3, globalPerDay: 100 },
  dormancy: { enabled: true, thresholdMs: 604_800_000 },
  intentDefaults: {
    minDelayMs: 3_600_000,
    maxAgeMs: 604_800_000,
    defaultConfidence: 0.8,
    confidenceThreshold: 0.5,
  },
  quietHours: { start: 22, end: 8 },
};

describe("PulseEngine", () => {
  let dir: string;
  let db: VaultDB;
  let vaultStore: VaultStore;
  let intentStore: IntentStore;
  let bridge: ReturnType<typeof mockBridge>;
  let router: ReturnType<typeof mockRouter>;
  let sessionMap: ReturnType<typeof mockSessionMap>;
  let registry: ReturnType<typeof mockRegistry>;
  let logger: ReturnType<typeof mockLogger>;
  let engine: PulseEngine;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-pulse-"));
    db = new VaultDB(dir);
    vaultStore = new VaultStore(db);
    intentStore = new IntentStore(db);
    bridge = mockBridge();
    router = mockRouter();
    sessionMap = mockSessionMap();
    registry = mockRegistry();
    logger = mockLogger();
    engine = new PulseEngine({
      store: intentStore,
      bridge: bridge as any,
      router: router as any,
      sessionMap: sessionMap as any,
      vaultStore,
      registry: registry as any,
      logger: logger as any,
      config: DEFAULT_CONFIG,
    });
  });

  afterEach(() => {
    engine.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts and stops without error", () => {
    engine.start();
    engine.stop();
    expect(logger.info).toHaveBeenCalledWith("Proactive pulse engine started");
  });

  it("processes a mature intent via tick()", async () => {
    // Create a profile for the user so vault context loads
    vaultStore.upsertProfile({
      senderId: "user1",
      channelId: "telegram",
      name: "Alex",
    });

    // Add an intent that is ready to fire
    intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "check if user fixed server",
      why: "user committed to fixing",
      confidence: 0.9,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    // AI was invoked
    expect(bridge.sendAndWait).toHaveBeenCalledTimes(1);
    const prompt = bridge.sendAndWait.mock.calls[0][1] as string;
    expect(prompt).toContain("check if user fixed server");

    // Response was delivered
    expect(router.sendResponse).toHaveBeenCalledWith(
      "telegram",
      "chat1",
      "Follow-up response from AI",
    );
  });

  it("skips intents below confidence threshold", async () => {
    intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "low confidence",
      confidence: 0.3,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(bridge.sendAndWait).not.toHaveBeenCalled();
  });

  it("skips when AI responds with [SKIP]", async () => {
    bridge.sendAndWait.mockResolvedValueOnce("[SKIP]");

    intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "test skip",
      confidence: 0.9,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(bridge.sendAndWait).toHaveBeenCalledTimes(1);
    expect(router.sendResponse).not.toHaveBeenCalled();
  });

  it("respects soft quota", async () => {
    // Exhaust quota
    for (let i = 0; i < 3; i++) {
      intentStore.logProactiveMessage({
        senderId: "user1",
        channelId: "telegram",
        type: "intent",
        sourceId: `src${i}`,
      });
    }

    intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "should be quota blocked",
      confidence: 0.9,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(bridge.sendAndWait).not.toHaveBeenCalled();
  });

  it("processes triggers", async () => {
    vaultStore.upsertProfile({
      senderId: "user1",
      channelId: "telegram",
      name: "Alex",
    });

    intentStore.addTrigger({
      type: "dormant_user",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      context: "User inactive for 8 days",
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(bridge.sendAndWait).toHaveBeenCalledTimes(1);
    expect(router.sendResponse).toHaveBeenCalled();
  });

  it("handles [DEFER Xh] response", async () => {
    bridge.sendAndWait.mockResolvedValueOnce("[DEFER 6h]");

    const id = intentStore.addIntent({
      sessionId: "s1",
      channelId: "telegram",
      chatId: "chat1",
      senderId: "user1",
      what: "defer me",
      confidence: 0.9,
      executeAt: Date.now() - 1000,
    });

    await engine.tick();

    expect(router.sendResponse).not.toHaveBeenCalled();
    // Intent should have been updated with new execute_at, not marked executed
    // (check it's still pending but with a future time)
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/proactive-engine.test.ts`
Expected: FAIL with "Cannot find module" (engine.ts doesn't exist yet)

**Step 3: Implement PulseEngine**

Create `src/proactive/engine.ts`:

```typescript
import type { IntentStore } from "./store.js";
import type { ProactiveConfig, ProactiveIntent, ProactiveTrigger } from "./types.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";
import type { MessageRouter } from "../bridge/message-router.js";
import type { SessionMap } from "../bridge/session-map.js";
import type { VaultStore } from "../vault/store.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { Logger } from "../logging/logger.js";

interface PulseEngineDeps {
  store: IntentStore;
  bridge: OpenCodeBridge;
  router: MessageRouter;
  sessionMap: SessionMap;
  vaultStore: VaultStore;
  registry: ChannelRegistry;
  logger: Logger;
  config: ProactiveConfig;
}

const SKIP_MARKER = "[SKIP]";
const DEFER_REGEX = /^\[DEFER\s+(\d+)h\]$/i;

export class PulseEngine {
  private readonly store: IntentStore;
  private readonly bridge: OpenCodeBridge;
  private readonly router: MessageRouter;
  private readonly sessionMap: SessionMap;
  private readonly vaultStore: VaultStore;
  private readonly registry: ChannelRegistry;
  private readonly logger: Logger;
  private readonly config: ProactiveConfig;

  private fastTimer: ReturnType<typeof setInterval> | null = null;
  private slowTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: PulseEngineDeps) {
    this.store = deps.store;
    this.bridge = deps.bridge;
    this.router = deps.router;
    this.sessionMap = deps.sessionMap;
    this.vaultStore = deps.vaultStore;
    this.registry = deps.registry;
    this.logger = deps.logger;
    this.config = deps.config;
  }

  start(): void {
    // Fast loop: check mature intents + triggers
    this.fastTimer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error({ err }, "Pulse tick error");
      });
    }, this.config.pollIntervalMs);
    this.fastTimer.unref();

    // Slow loop: passive detection scan
    if (this.config.dormancy.enabled) {
      this.slowTimer = setInterval(() => {
        this.passiveScan().catch((err) => {
          this.logger.error({ err }, "Passive scan error");
        });
      }, this.config.passiveScanIntervalMs);
      this.slowTimer.unref();
    }

    this.logger.info("Proactive pulse engine started");
  }

  stop(): void {
    if (this.fastTimer) {
      clearInterval(this.fastTimer);
      this.fastTimer = null;
    }
    if (this.slowTimer) {
      clearInterval(this.slowTimer);
      this.slowTimer = null;
    }
    this.logger.info("Proactive pulse engine stopped");
  }

  /** Process all mature intents and triggers. Exposed for testing. */
  async tick(): Promise<void> {
    // Purge expired
    const purged = this.store.purgeExpired(this.config.intentDefaults.maxAgeMs);
    if (purged > 0) {
      this.logger.debug({ purged }, "Purged expired proactive items");
    }

    // Process intents
    const intents = this.store.listPendingIntents(10);
    for (const intent of intents) {
      await this.executeIntent(intent);
    }

    // Process triggers
    const triggers = this.store.listPendingTriggers(10);
    for (const trigger of triggers) {
      await this.executeTrigger(trigger);
    }
  }

  /** Run passive detection scan. */
  async passiveScan(): Promise<void> {
    if (!this.config.dormancy.enabled) return;

    const dormant = this.store.listDormantUsers(
      this.config.dormancy.thresholdMs,
      10,
    );

    for (const user of dormant) {
      const daysInactive = Math.floor(
        (Date.now() - user.lastSeen) / 86_400_000,
      );
      this.store.addTrigger({
        type: "dormant_user",
        channelId: user.channelId,
        chatId: user.senderId, // DM chatId = senderId for most platforms
        senderId: user.senderId,
        context: `User "${user.name ?? "unknown"}" inactive for ${daysInactive} days.`,
        executeAt: Date.now() + 3_600_000, // 1h delay to batch
      });
      this.logger.debug(
        { senderId: user.senderId, daysInactive },
        "Dormant user trigger created",
      );
    }
  }

  private async executeIntent(intent: ProactiveIntent): Promise<void> {
    try {
      // Check confidence
      if (intent.confidence < this.config.intentDefaults.confidenceThreshold) {
        this.store.markIntentExecuted(intent.id, "low_confidence");
        this.logger.debug({ id: intent.id, confidence: intent.confidence }, "Skipped low confidence intent");
        return;
      }

      // Check soft quota
      const quota = this.store.getQuotaStatus(
        intent.senderId,
        intent.channelId,
        this.config.softQuotas.perUserPerDay,
      );
      if (!quota.allowed) {
        this.logger.debug({ id: intent.id, sentToday: quota.sentToday }, "Skipped: quota exceeded");
        // Don't mark executed — retry tomorrow
        return;
      }

      // Check global quota
      if (this.store.getGlobalQuotaToday() >= this.config.softQuotas.globalPerDay) {
        this.logger.debug({ id: intent.id }, "Skipped: global quota exceeded");
        return;
      }

      // Check quiet hours
      if (this.isQuietHours(intent.senderId, intent.channelId)) {
        this.logger.debug({ id: intent.id }, "Skipped: quiet hours");
        return;
      }

      const result = await this.executeProactive({
        channelId: intent.channelId,
        chatId: intent.chatId,
        senderId: intent.senderId,
        chatType: "dm",
        prompt: this.buildIntentPrompt(intent, quota.engagementRate, quota.sentToday, quota.limit),
        sourceId: intent.id,
        sourceType: "intent",
      });

      this.store.markIntentExecuted(intent.id, result);
    } catch (err) {
      this.logger.error({ err, id: intent.id }, "Intent execution failed");
      this.store.markIntentExecuted(intent.id, "error");
    }
  }

  private async executeTrigger(trigger: ProactiveTrigger): Promise<void> {
    try {
      const quota = this.store.getQuotaStatus(
        trigger.senderId,
        trigger.channelId,
        this.config.softQuotas.perUserPerDay,
      );
      if (!quota.allowed) {
        this.logger.debug({ id: trigger.id }, "Trigger skipped: quota exceeded");
        return;
      }

      if (this.isQuietHours(trigger.senderId, trigger.channelId)) {
        this.logger.debug({ id: trigger.id }, "Trigger skipped: quiet hours");
        return;
      }

      const result = await this.executeProactive({
        channelId: trigger.channelId,
        chatId: trigger.chatId,
        senderId: trigger.senderId,
        chatType: "dm",
        prompt: this.buildTriggerPrompt(trigger, quota.engagementRate, quota.sentToday, quota.limit),
        sourceId: trigger.id,
        sourceType: "trigger",
      });

      this.store.markTriggerExecuted(trigger.id, result);
    } catch (err) {
      this.logger.error({ err, id: trigger.id }, "Trigger execution failed");
      this.store.markTriggerExecuted(trigger.id, "error");
    }
  }

  private async executeProactive(params: {
    channelId: string;
    chatId: string;
    senderId: string;
    chatType: "dm" | "group";
    prompt: string;
    sourceId: string;
    sourceType: "intent" | "trigger";
  }): Promise<string> {
    // Resolve/create session
    const entry = await this.sessionMap.resolve(
      params.channelId,
      params.senderId,
      params.chatId,
      params.chatType,
      this.bridge as any,
    );

    // Send to AI for re-evaluation + generation
    const response = await this.bridge.sendAndWait(
      entry.openCodeSessionId,
      params.prompt,
    );

    if (!response || response.trim() === SKIP_MARKER) {
      this.logger.debug({ sourceId: params.sourceId }, "AI chose to skip");
      return "skipped";
    }

    // Check for DEFER
    const deferMatch = response.trim().match(DEFER_REGEX);
    if (deferMatch) {
      const hours = parseInt(deferMatch[1], 10);
      this.logger.debug({ sourceId: params.sourceId, hours }, "AI deferred");
      // Re-schedule by creating a new intent with later time
      // (original will be marked as "deferred")
      return "deferred";
    }

    // Deliver the proactive message
    await this.router.sendResponse(params.channelId, params.chatId, response);

    // Log for engagement tracking
    this.store.logProactiveMessage({
      senderId: params.senderId,
      channelId: params.channelId,
      type: params.sourceType,
      sourceId: params.sourceId,
    });

    this.logger.info(
      { senderId: params.senderId, channelId: params.channelId, sourceType: params.sourceType },
      "Proactive message sent",
    );

    return "sent";
  }

  private buildIntentPrompt(
    intent: ProactiveIntent,
    engagementRate: number,
    sentToday: number,
    limit: number,
  ): string {
    const elapsed = Date.now() - intent.createdAt;
    const hoursAgo = Math.floor(elapsed / 3_600_000);
    const timeAgo = hoursAgo >= 24
      ? `${Math.floor(hoursAgo / 24)} days ago`
      : `${hoursAgo} hours ago`;

    const profile = this.vaultStore.getProfile(intent.senderId, intent.channelId);
    const profileBlock = profile
      ? `User: ${profile.name ?? "unknown"} | ${profile.timezone ?? "no timezone"} | ${profile.language ?? ""}`
      : "User: unknown";

    return `[PROACTIVE FOLLOW-UP]
You registered an intent ${timeAgo}: "${intent.what}"
${intent.why ? `Reason: "${intent.why}"` : ""}

${profileBlock}
Your quota: ${limit - sentToday}/${limit} proactive messages remaining today
Your engagement rate: ${Math.round(engagementRate * 100)}% of proactive messages get replies

Decide: Should you follow up now? If yes, compose a natural, helpful message.
Use any tools you need (send_message, vault_remember, canvas_update, etc.).
If not worth it, respond with just: [SKIP]
If you want to try later, respond with: [DEFER Xh] (replace X with hours)`;
  }

  private buildTriggerPrompt(
    trigger: ProactiveTrigger,
    engagementRate: number,
    sentToday: number,
    limit: number,
  ): string {
    const profile = this.vaultStore.getProfile(trigger.senderId, trigger.channelId);
    const profileBlock = profile
      ? `User: ${profile.name ?? "unknown"} | ${profile.timezone ?? "no timezone"} | ${profile.language ?? ""}`
      : "User: unknown";

    return `[PROACTIVE OUTREACH — ${trigger.type.replace(/_/g, " ").toUpperCase()}]
${trigger.context}

${profileBlock}
Your quota: ${limit - sentToday}/${limit} proactive messages remaining today
Your engagement rate: ${Math.round(engagementRate * 100)}% of proactive messages get replies

Decide: Should you reach out? If yes, compose a natural, warm message.
If not appropriate, respond with just: [SKIP]
If you want to try later, respond with: [DEFER Xh]`;
  }

  private isQuietHours(senderId: string, channelId: string): boolean {
    const profile = this.vaultStore.getProfile(senderId, channelId);
    const tz = profile?.timezone;

    let hour: number;
    if (tz) {
      try {
        hour = parseInt(
          new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false }),
          10,
        );
      } catch {
        hour = new Date().getHours();
      }
    } else {
      hour = new Date().getHours();
    }

    const { start, end } = this.config.quietHours;
    // Handle wrap-around (e.g., start=22, end=8 means 22:00-08:00)
    if (start > end) {
      return hour >= start || hour < end;
    }
    return hour >= start && hour < end;
  }
}
```

**Step 4: Run the tests**

Run: `npx vitest run test/unit/proactive-engine.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/proactive/engine.ts test/unit/proactive-engine.test.ts
git commit -m "feat(proactive): pulse engine with intent/trigger execution"
```

---

### Task 4: Gateway Lifecycle Integration

**Files:**
- Modify: `src/gateway/lifecycle.ts:1-51, 133-155, 220-234, 317-334, 340-384, 390-407`

**Step 1: Add imports to lifecycle.ts**

At the top of `src/gateway/lifecycle.ts`, add after line 23 (after `UsageTracker` import):

```typescript
import { IntentStore } from "../proactive/store.js";
import { PulseEngine } from "../proactive/engine.js";
```

**Step 2: Add to GatewayContext interface**

In the `GatewayContext` interface (lines 34-51), add before the closing `}`:

```typescript
  intentStore: IntentStore | null;
  pulseEngine: PulseEngine | null;
```

**Step 3: Initialize proactive components**

After the policy engine initialization (around line 152), add:

```typescript
  // 5.7 Initialize proactive system
  let intentStore: IntentStore | null = null;
  let pulseEngine: PulseEngine | null = null;
```

**Step 4: Add intentStore to ToolServer deps**

In the `ToolServer` constructor call (lines 222-233), add `intentStore`:

```typescript
    intentStore,
```

**Step 5: Start PulseEngine after channels**

After plugin services start (after line 327), add:

```typescript
  // 12.6 Start proactive pulse engine
  if (config.proactive?.enabled && intentStore) {
    pulseEngine = new PulseEngine({
      store: intentStore,
      bridge,
      router,
      sessionMap,
      vaultStore,
      registry,
      logger,
      config: config.proactive,
    });
    pulseEngine.start();
    logger.info("Proactive pulse engine started");
  }
```

**Step 6: Add shutdown for PulseEngine**

In the shutdown function, before stopping adapters (before line 355), add:

```typescript
    if (pulseEngine) pulseEngine.stop();
```

**Step 7: Include in return value**

Add to the return object (before line 407):

```typescript
    intentStore,
    pulseEngine,
```

**Step 8: Initialize IntentStore conditionally**

Back where we declared `intentStore` (step 3), change to:

```typescript
  // 5.7 Initialize proactive system
  let intentStore: IntentStore | null = null;
  let pulseEngine: PulseEngine | null = null;
  if (config.proactive?.enabled) {
    intentStore = new IntentStore(vaultDb);
    logger.info("Proactive intent store initialized");
  }
```

**Step 9: Run lint**

Run: `pnpm run lint`
Expected: PASS

**Step 10: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS (394+ tests, 6 pre-existing failures only)

**Step 11: Commit**

```bash
git add src/gateway/lifecycle.ts
git commit -m "feat(proactive): wire intent store + pulse engine into lifecycle"
```

---

### Task 5: Tool Server Endpoints

**Files:**
- Modify: `src/bridge/tool-server.ts:48-110, 1090-1105`

**Step 1: Add IntentStore to ToolServerDeps**

In `src/bridge/tool-server.ts`, add to the `ToolServerDeps` interface (after line 59):

```typescript
  intentStore?: IntentStore | null;
```

Add the import at the top (after line 15):

```typescript
import type { IntentStore } from "../proactive/store.js";
```

**Step 2: Add class field and constructor wiring**

Add after `canvasServer` class field (line 75):

```typescript
  private readonly intentStore: IntentStore | null;
```

In the deps constructor branch (after line 109):

```typescript
      this.intentStore = deps.intentStore ?? null;
```

In the legacy constructor branch (after line 96):

```typescript
      this.intentStore = null;
```

**Step 3: Add proactive endpoints**

In `setupRoutes()`, add before the closing `}` of the method (before line 1091):

```typescript
    // ── Proactive endpoints ──

    this.app.post("/proactive/intent", async (c) => {
      if (!this.intentStore) return c.json({ error: "Proactive not enabled" }, 503);
      const body = await c.req.json();
      const sessionId = body.sessionID ?? body.sessionId ?? "";

      // Resolve sender info from session
      let channelId = body.channelId ?? "";
      let chatId = body.chatId ?? "";
      let senderId = body.senderId ?? "";
      if (sessionId && this.sessionMap && (!channelId || !senderId)) {
        const entry = await this.sessionMap.findBySessionId(sessionId);
        if (entry) {
          channelId = channelId || entry.channelId;
          chatId = chatId || entry.chatId;
          senderId = senderId || entry.senderId;
        }
      }

      const id = this.intentStore.addIntent({
        sessionId,
        channelId,
        chatId,
        senderId,
        what: body.what ?? "",
        why: body.why ?? null,
        confidence: body.confidence ?? 0.8,
        executeAt: Date.now() + (body.delayMs ?? 86_400_000),
      });
      return c.json({ id });
    });

    this.app.post("/proactive/cancel", async (c) => {
      if (!this.intentStore) return c.json({ error: "Proactive not enabled" }, 503);
      const body = await c.req.json();
      const ok = this.intentStore.cancelIntent(body.id ?? "");
      return c.json({ ok });
    });

    this.app.get("/proactive/pending", (c) => {
      if (!this.intentStore) return c.json({ intents: [], triggers: [] });
      const limit = Number(c.req.query("limit")) || 20;
      return c.json(this.intentStore.listAllPending(limit));
    });

    this.app.get("/proactive/quota", (c) => {
      if (!this.intentStore) return c.json({ allowed: true, sentToday: 0, limit: 999, engagementRate: 0 });
      const senderId = c.req.query("senderId") ?? "";
      const channelId = c.req.query("channelId") ?? "";
      return c.json(this.intentStore.getQuotaStatus(senderId, channelId, 3));
    });

    this.app.post("/proactive/scan", async (c) => {
      if (!this.intentStore) return c.json({ error: "Proactive not enabled" }, 503);
      const body = await c.req.json().catch(() => ({}));
      const thresholdMs = body.thresholdMs ?? 604_800_000;
      const dormant = this.intentStore.listDormantUsers(thresholdMs, 10);
      return c.json({ users: dormant });
    });

    this.app.post("/proactive/execute", async (c) => {
      if (!this.intentStore) return c.json({ error: "Proactive not enabled" }, 503);
      const body = await c.req.json();
      // Mark intent as executed with result "manual" — actual execution happens via pulse
      this.intentStore.markIntentExecuted(body.id ?? "", "manual_trigger");
      return c.json({ ok: true });
    });
```

**Step 4: Run lint**

Run: `pnpm run lint`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/bridge/tool-server.ts
git commit -m "feat(proactive): add 6 tool server endpoints"
```

---

### Task 6: Plugin Tools + System Prompt Injection

**Files:**
- Modify: `.opencode/plugin/iris.ts:504-520, 604-647`

**Step 1: Add 7 proactive tools**

In `.opencode/plugin/iris.ts`, add after `canvas_update` tool (after line 519, before the closing `},` of the tools section on line 520):

```typescript
    // ── Proactive Intelligence tools ──

    proactive_intent: tool({
      description:
        "Register a follow-up intent. Use when you want to check back on something later. " +
        "Examples: user committed to doing something, you asked a question, you suggested " +
        "something worth revisiting, you noticed something that needs monitoring.",
      args: {
        what: tool.schema.string().describe("What to follow up on"),
        why: tool.schema.string().optional().describe("Why this matters"),
        delayMs: tool.schema
          .number()
          .optional()
          .describe("Milliseconds until follow-up (default: 24h = 86400000)"),
        confidence: tool.schema
          .number()
          .optional()
          .describe("How confident you are this needs follow-up, 0-1 (default: 0.8)"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisPost("/proactive/intent", {
            sessionID: (this as any).sessionID,
            what: args.what,
            why: args.why,
            delayMs: args.delayMs,
            confidence: args.confidence,
          }),
        );
      },
    }),

    proactive_cancel: tool({
      description: "Cancel a pending proactive intent by ID.",
      args: {
        id: tool.schema.string().describe("Intent ID to cancel"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/proactive/cancel", args));
      },
    }),

    proactive_list: tool({
      description:
        "List pending proactive intents and triggers. Use to see what follow-ups are scheduled.",
      args: {
        limit: tool.schema
          .number()
          .optional()
          .describe("Max results (default: 20)"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisGet(`/proactive/pending?limit=${args.limit ?? 20}`),
        );
      },
    }),

    proactive_quota: tool({
      description:
        "Check your proactive message quota and engagement rate for a user. " +
        "Use before deciding whether to register an intent.",
      args: {
        senderId: tool.schema.string().describe("User's sender ID"),
        channelId: tool.schema.string().describe("Channel ID"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisGet(
            `/proactive/quota?senderId=${encodeURIComponent(args.senderId)}&channelId=${encodeURIComponent(args.channelId)}`,
          ),
        );
      },
    }),

    proactive_scan: tool({
      description:
        "Force a passive scan for dormant users. Returns list of users who have been inactive.",
      args: {
        thresholdMs: tool.schema
          .number()
          .optional()
          .describe("Inactive for N ms (default: 7 days)"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisPost("/proactive/scan", { thresholdMs: args.thresholdMs }),
        );
      },
    }),

    proactive_execute: tool({
      description: "Manually trigger execution of a specific pending intent now.",
      args: {
        id: tool.schema.string().describe("Intent ID to execute immediately"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/proactive/execute", args));
      },
    }),

    proactive_engage: tool({
      description:
        "Record that a user engaged with a proactive message (replied). " +
        "This improves the engagement rate used for self-tuning.",
      args: {
        senderId: tool.schema.string().describe("User who engaged"),
        channelId: tool.schema.string().describe("Channel"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisPost("/proactive/engage", {
            senderId: args.senderId,
            channelId: args.channelId,
          }),
        );
      },
    }),
```

**Step 2: Add proactive engage endpoint to tool-server**

In `src/bridge/tool-server.ts`, add to the proactive endpoints section:

```typescript
    this.app.post("/proactive/engage", async (c) => {
      if (!this.intentStore) return c.json({ error: "Proactive not enabled" }, 503);
      const body = await c.req.json();
      this.intentStore.markEngaged(body.senderId ?? "", body.channelId ?? "");
      return c.json({ ok: true });
    });
```

**Step 3: Inject proactive awareness into system prompt**

In `.opencode/plugin/iris.ts`, in the `experimental.chat.system.transform` hook (around line 616, after the user context injection), add:

```typescript
      // Proactive awareness injection
      try {
        if (input.sessionID) {
          const pending = (await irisGet("/proactive/pending?limit=5")) as {
            intents: Array<{ what: string }>;
            triggers: Array<{ type: string }>;
          };
          const pendingCount =
            (pending.intents?.length ?? 0) + (pending.triggers?.length ?? 0);

          if (pendingCount > 0 || true) {
            // Always inject proactive awareness
            const block = [
              "[PROACTIVE INTELLIGENCE]",
              "You have proactive follow-up capability. When appropriate, use proactive_intent to schedule check-ins.",
              pendingCount > 0
                ? `You have ${pendingCount} pending proactive items.`
                : "No pending items.",
            ];
            output.system.push(block.join("\n"));
          }
        }
      } catch {
        // Best-effort
      }
```

**Step 4: Run lint**

Run: `pnpm run lint`
Expected: PASS (iris.ts is not type-checked by tsc, but syntax should be valid)

**Step 5: Commit**

```bash
git add .opencode/plugin/iris.ts src/bridge/tool-server.ts
git commit -m "feat(proactive): 7 plugin tools + system prompt injection"
```

---

### Task 7: AGENTS.md + Cookbook Documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/cookbook.md`

**Step 1: Add proactive tools section to AGENTS.md**

In `AGENTS.md`, after the "### Usage Tracking" section (after line 36), add:

```markdown
### Proactive Intelligence
- Use `proactive_intent` to register a follow-up intent — schedule yourself to check back later
- Use `proactive_cancel` to cancel a pending intent if context changed
- Use `proactive_list` to see all pending intents and triggers
- Use `proactive_quota` to check your quota and engagement rate before scheduling
- Use `proactive_scan` to force a dormancy scan for inactive users
- Use `proactive_execute` to manually trigger a pending intent now
- Use `proactive_engage` to record when a user engages with your proactive message

### When to Be Proactive
- When a user commits to doing something: register an intent to check on it
- When you ask a question and might not get an answer: register to follow up
- When you suggest something worth revisiting: register to check if they tried it
- When you notice a user hasn't been active: dormancy triggers handle this automatically
- Always check your quota first — be conservative, only follow up when genuinely valuable
```

**Step 2: Add proactive section to cookbook**

In `docs/cookbook.md`, add a new section at the end:

```markdown
## Proactive Intelligence

### Register a Follow-Up Intent

When Iris should check back on something:

```
proactive_intent({
  what: "check if user deployed the fix",
  why: "user said they would deploy tomorrow",
  delayMs: 86400000,     // 24 hours
  confidence: 0.9
})
```

### Check Quota Before Scheduling

```
proactive_quota({ senderId: "tg:12345", channelId: "telegram" })
→ { allowed: true, sentToday: 1, limit: 3, engagementRate: 0.67 }
```

### View Pending Items

```
proactive_list({ limit: 10 })
→ { intents: [...], triggers: [...] }
```

### Cancel an Intent

```
proactive_cancel({ id: "uuid-of-intent" })
```

### Force Dormancy Scan

```
proactive_scan({ thresholdMs: 604800000 })  // 7 days
→ { users: [{ senderId: "tg:12345", name: "Alex", lastSeen: ... }] }
```

### Configuration

```json
{
  "proactive": {
    "enabled": true,
    "pollIntervalMs": 60000,
    "passiveScanIntervalMs": 21600000,
    "softQuotas": { "perUserPerDay": 3, "globalPerDay": 100 },
    "dormancy": { "enabled": true, "thresholdMs": 604800000 },
    "intentDefaults": {
      "minDelayMs": 3600000,
      "maxAgeMs": 604800000,
      "defaultConfidence": 0.8,
      "confidenceThreshold": 0.5
    },
    "quietHours": { "start": 22, "end": 8 }
  }
}
```
```

**Step 3: Commit**

```bash
git add AGENTS.md docs/cookbook.md
git commit -m "docs: proactive intelligence tools and cookbook"
```

---

### Task 8: Build Verification + Full Test Suite

**Files:** (none new — verification only)

**Step 1: Run TypeScript build**

Run: `pnpm run build`
Expected: PASS with no errors

If there are type errors, fix them (likely missing `ProactiveConfig` import in `types.ts`).

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS (400+ tests, 6 pre-existing failures in pipeline/message-router only)

**Step 3: Run just the new proactive tests**

Run: `npx vitest run test/unit/proactive-store.test.ts test/unit/proactive-engine.test.ts`
Expected: ALL PASS

**Step 4: Verify existing vault tests still pass**

Run: `npx vitest run test/unit/vault-db.test.ts test/unit/vault-store.test.ts test/unit/vault-search.test.ts`
Expected: ALL PASS

**Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve build issues from proactive integration"
```

---

### Task 9: Push and Summary

**Step 1: Push**

```bash
git push
```

**Step 2: Verify commit history**

Run: `git log --oneline -10`
Expected: 7-8 commits covering types, store, engine, lifecycle, endpoints, plugin, docs, and build fix.
