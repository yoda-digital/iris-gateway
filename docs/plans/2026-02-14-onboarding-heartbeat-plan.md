# Onboarding & Heartbeat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add invisible onboarding (Living Profile) and adaptive self-healing heartbeat (The Pulse) to Iris.

**Architecture:** Two-layer onboarding — first-contact meta-prompt injection in MessageRouter + background ProfileEnricher on every message. Independent HeartbeatEngine with 6 parallel health checkers, adaptive tick intervals, and self-healing pipeline. Both systems optional and configured via `iris.yaml`.

**Tech Stack:** TypeScript (ESM), better-sqlite3, Hono, vitest, zod

---

### Task 1: Onboarding Types + Signal Store

**Files:**
- Create: `src/onboarding/types.ts`
- Create: `src/onboarding/signals.ts`
- Test: `test/unit/onboarding-signals.test.ts`

**Step 1: Write the failing test**

Create `test/unit/onboarding-signals.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { SignalStore } from "../../src/onboarding/signals.js";

describe("SignalStore", () => {
  let dir: string;
  let db: VaultDB;
  let store: SignalStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-signals-"));
    db = new VaultDB(dir);
    store = new SignalStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds and retrieves signals", () => {
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "Europe/Chisinau",
      confidence: 0.7,
    });
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "language",
      value: "ro",
      confidence: 0.6,
    });

    const signals = store.getSignals("user1", "telegram");
    expect(signals).toHaveLength(2);
    expect(signals[0].signalType).toBe("timezone");
  });

  it("gets latest signal by type", () => {
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "Europe/Berlin",
      confidence: 0.5,
    });
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "Europe/Chisinau",
      confidence: 0.8,
    });

    const latest = store.getLatestSignal("user1", "telegram", "timezone");
    expect(latest).not.toBeNull();
    expect(latest!.value).toBe("Europe/Chisinau");
    expect(latest!.confidence).toBe(0.8);
  });

  it("purges old signals", () => {
    store.addSignal({
      senderId: "user1",
      channelId: "telegram",
      signalType: "timezone",
      value: "UTC",
      confidence: 0.5,
    });

    // Purge with 0 retention = purge everything
    const purged = store.purgeOlderThan(0);
    expect(purged).toBe(1);

    const signals = store.getSignals("user1", "telegram");
    expect(signals).toHaveLength(0);
  });

  it("consolidates signals into highest-confidence map", () => {
    store.addSignal({ senderId: "u1", channelId: "tg", signalType: "timezone", value: "UTC", confidence: 0.3 });
    store.addSignal({ senderId: "u1", channelId: "tg", signalType: "timezone", value: "Europe/Chisinau", confidence: 0.9 });
    store.addSignal({ senderId: "u1", channelId: "tg", signalType: "language", value: "ro", confidence: 0.7 });

    const consolidated = store.consolidate("u1", "tg");
    expect(consolidated.get("timezone")).toBe("Europe/Chisinau");
    expect(consolidated.get("language")).toBe("ro");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/onboarding-signals.test.ts`
Expected: FAIL — module `../../src/onboarding/signals.js` not found

**Step 3: Create the types file**

Create `src/onboarding/types.ts`:

```typescript
export interface ProfileSignal {
  readonly id: number;
  readonly senderId: string;
  readonly channelId: string;
  readonly signalType: string;
  readonly value: string;
  readonly confidence: number;
  readonly observedAt: number;
}

export interface AddSignalParams {
  readonly senderId: string;
  readonly channelId: string;
  readonly signalType: string;
  readonly value: string;
  readonly confidence?: number;
}

export interface OnboardingConfig {
  readonly enabled: boolean;
  readonly enricher: {
    readonly enabled: boolean;
    readonly signalRetentionDays: number;
    readonly consolidateIntervalMs: number;
  };
  readonly firstContact: {
    readonly enabled: boolean;
  };
}
```

**Step 4: Create the signal store**

Create `src/onboarding/signals.ts`:

```typescript
import type { VaultDB } from "../vault/db.js";
import type { ProfileSignal, AddSignalParams } from "./types.js";

const SIGNALS_SCHEMA = `
CREATE TABLE IF NOT EXISTS profile_signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  value       TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 0.5,
  observed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_sender
  ON profile_signals(sender_id, signal_type);
`;

export class SignalStore {
  private readonly db;

  constructor(vaultDb: VaultDB) {
    this.db = vaultDb.raw();
    this.db.exec(SIGNALS_SCHEMA);
  }

  addSignal(params: AddSignalParams): void {
    this.db
      .prepare(
        `INSERT INTO profile_signals (sender_id, channel_id, signal_type, value, confidence, observed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.senderId,
        params.channelId,
        params.signalType,
        params.value,
        params.confidence ?? 0.5,
        Date.now(),
      );
  }

  getSignals(senderId: string, channelId: string): ProfileSignal[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM profile_signals
         WHERE sender_id = ? AND channel_id = ?
         ORDER BY observed_at DESC`,
      )
      .all(senderId, channelId) as Record<string, unknown>[];
    return rows.map((r) => this.toSignal(r));
  }

  getLatestSignal(senderId: string, channelId: string, signalType: string): ProfileSignal | null {
    const row = this.db
      .prepare(
        `SELECT * FROM profile_signals
         WHERE sender_id = ? AND channel_id = ? AND signal_type = ?
         ORDER BY observed_at DESC LIMIT 1`,
      )
      .get(senderId, channelId, signalType) as Record<string, unknown> | undefined;
    return row ? this.toSignal(row) : null;
  }

  consolidate(senderId: string, channelId: string): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT signal_type, value, MAX(confidence) as max_conf
         FROM profile_signals
         WHERE sender_id = ? AND channel_id = ?
         GROUP BY signal_type
         HAVING confidence = max_conf`,
      )
      .all(senderId, channelId) as Array<{ signal_type: string; value: string }>;

    const result = new Map<string, string>();
    for (const row of rows) {
      result.set(row.signal_type, row.value);
    }
    return result;
  }

  purgeOlderThan(retentionMs: number): number {
    const cutoff = Date.now() - retentionMs;
    const result = this.db
      .prepare("DELETE FROM profile_signals WHERE observed_at < ?")
      .run(cutoff);
    return result.changes;
  }

  private toSignal(row: Record<string, unknown>): ProfileSignal {
    return {
      id: row["id"] as number,
      senderId: row["sender_id"] as string,
      channelId: row["channel_id"] as string,
      signalType: row["signal_type"] as string,
      value: row["value"] as string,
      confidence: row["confidence"] as number,
      observedAt: row["observed_at"] as number,
    };
  }
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/unit/onboarding-signals.test.ts`
Expected: 4/4 PASS

**Step 6: Commit**

```bash
git add src/onboarding/types.ts src/onboarding/signals.ts test/unit/onboarding-signals.test.ts
git commit -m "feat(onboarding): signal store with types and consolidation"
```

---

### Task 2: ProfileEnricher

**Files:**
- Create: `src/onboarding/enricher.ts`
- Test: `test/unit/onboarding-enricher.test.ts`

**Step 1: Write the failing test**

Create `test/unit/onboarding-enricher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";
import { SignalStore } from "../../src/onboarding/signals.js";
import { ProfileEnricher } from "../../src/onboarding/enricher.js";

function mockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(), fatal: vi.fn(),
  } as any;
}

describe("ProfileEnricher", () => {
  let dir: string;
  let db: VaultDB;
  let vaultStore: VaultStore;
  let signalStore: SignalStore;
  let enricher: ProfileEnricher;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-enricher-"));
    db = new VaultDB(dir);
    vaultStore = new VaultStore(db);
    signalStore = new SignalStore(db);
    enricher = new ProfileEnricher(signalStore, vaultStore, mockLogger());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects language from text", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "Salut, cum esti?",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "language");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("ro");
  });

  it("infers active hours from timestamp", () => {
    const ts = new Date();
    ts.setHours(14, 30, 0, 0);

    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "hello",
      timestamp: ts.getTime(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "active_hour");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("14");
  });

  it("detects name from self-introduction", () => {
    enricher.enrich({
      senderId: "user1",
      channelId: "telegram",
      text: "Hi, I'm Alexander",
      timestamp: Date.now(),
    });

    const signal = signalStore.getLatestSignal("user1", "telegram", "name");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("Alexander");
  });

  it("detects response style (short messages)", () => {
    for (let i = 0; i < 5; i++) {
      enricher.enrich({
        senderId: "user1",
        channelId: "telegram",
        text: "ok",
        timestamp: Date.now(),
      });
    }

    const signal = signalStore.getLatestSignal("user1", "telegram", "response_style");
    expect(signal).not.toBeNull();
    expect(signal!.value).toBe("concise");
  });

  it("consolidates signals into profile", () => {
    signalStore.addSignal({ senderId: "u1", channelId: "tg", signalType: "timezone", value: "Europe/Chisinau", confidence: 0.9 });
    signalStore.addSignal({ senderId: "u1", channelId: "tg", signalType: "language", value: "ro", confidence: 0.8 });

    vaultStore.upsertProfile({ senderId: "u1", channelId: "tg" });

    enricher.consolidateProfile("u1", "tg");

    const profile = vaultStore.getProfile("u1", "tg");
    expect(profile).not.toBeNull();
    expect(profile!.timezone).toBe("Europe/Chisinau");
    expect(profile!.language).toBe("ro");
  });

  it("isFirstContact returns true for brand new user", () => {
    // Profile just created (first_seen == last_seen, within 30s)
    vaultStore.upsertProfile({ senderId: "new-user", channelId: "telegram" });
    const profile = vaultStore.getProfile("new-user", "telegram");
    expect(enricher.isFirstContact(profile!)).toBe(true);
  });

  it("isFirstContact returns false for returning user", () => {
    vaultStore.upsertProfile({ senderId: "old-user", channelId: "telegram" });
    // Simulate time passing by updating again
    const db2 = db.raw();
    db2.prepare("UPDATE profiles SET first_seen = ? WHERE sender_id = ?")
      .run(Date.now() - 60_000, "old-user");

    const profile = vaultStore.getProfile("old-user", "telegram");
    expect(enricher.isFirstContact(profile!)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/onboarding-enricher.test.ts`
Expected: FAIL — module `../../src/onboarding/enricher.js` not found

**Step 3: Create the enricher**

Create `src/onboarding/enricher.ts`:

```typescript
import type { SignalStore } from "./signals.js";
import type { VaultStore } from "../vault/store.js";
import type { UserProfile } from "../vault/types.js";
import type { Logger } from "../logging/logger.js";

interface EnrichParams {
  readonly senderId: string;
  readonly channelId: string;
  readonly text: string;
  readonly timestamp: number;
}

// Simple language heuristics — match common greetings/words
const LANG_PATTERNS: Array<{ pattern: RegExp; lang: string }> = [
  { pattern: /\b(salut|bun[aă]|mul[tț]umesc|cum\s+e[sș]ti)\b/i, lang: "ro" },
  { pattern: /\b(привет|здравствуй|спасибо|как\s+дела)\b/i, lang: "ru" },
  { pattern: /\b(hola|gracias|buenos|cómo)\b/i, lang: "es" },
  { pattern: /\b(bonjour|merci|comment|salut)\b/i, lang: "fr" },
  { pattern: /\b(hallo|danke|wie\s+geht)\b/i, lang: "de" },
];

const NAME_PATTERNS: RegExp[] = [
  /\bI'?m\s+([A-Z][a-z]{1,20})\b/,
  /\bmy\s+name\s+is\s+([A-Z][a-z]{1,20})\b/i,
  /\bcall\s+me\s+([A-Z][a-z]{1,20})\b/i,
];

const FIRST_CONTACT_WINDOW_MS = 30_000;

/** Message length moving average — track per user in memory */
const messageLengths = new Map<string, number[]>();

export class ProfileEnricher {
  constructor(
    private readonly signals: SignalStore,
    private readonly vaultStore: VaultStore,
    private readonly logger: Logger,
  ) {}

  enrich(params: EnrichParams): void {
    const { senderId, channelId, text, timestamp } = params;

    // 1. Language detection
    for (const { pattern, lang } of LANG_PATTERNS) {
      if (pattern.test(text)) {
        this.signals.addSignal({
          senderId, channelId,
          signalType: "language",
          value: lang,
          confidence: 0.6,
        });
        break;
      }
    }

    // 2. Active hours
    const hour = new Date(timestamp).getHours();
    this.signals.addSignal({
      senderId, channelId,
      signalType: "active_hour",
      value: String(hour),
      confidence: 0.5,
    });

    // 3. Name extraction
    for (const pattern of NAME_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        this.signals.addSignal({
          senderId, channelId,
          signalType: "name",
          value: match[1],
          confidence: 0.8,
        });
        break;
      }
    }

    // 4. Response style (track message lengths)
    const key = `${senderId}:${channelId}`;
    const lengths = messageLengths.get(key) ?? [];
    lengths.push(text.length);
    if (lengths.length > 20) lengths.shift();
    messageLengths.set(key, lengths);

    if (lengths.length >= 5) {
      const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const style = avg < 30 ? "concise" : avg < 150 ? "moderate" : "verbose";
      this.signals.addSignal({
        senderId, channelId,
        signalType: "response_style",
        value: style,
        confidence: Math.min(0.5 + lengths.length * 0.02, 0.9),
      });
    }
  }

  consolidateProfile(senderId: string, channelId: string): void {
    const consolidated = this.signals.consolidate(senderId, channelId);

    const updates: { timezone?: string; language?: string; name?: string } = {};
    if (consolidated.has("timezone")) updates.timezone = consolidated.get("timezone")!;
    if (consolidated.has("language")) updates.language = consolidated.get("language")!;
    if (consolidated.has("name")) updates.name = consolidated.get("name")!;

    if (Object.keys(updates).length > 0) {
      this.vaultStore.upsertProfile({
        senderId,
        channelId,
        ...updates,
      });
      this.logger.debug({ senderId, channelId, updates }, "Profile enriched from signals");
    }
  }

  isFirstContact(profile: UserProfile): boolean {
    const age = Date.now() - profile.firstSeen;
    return age < FIRST_CONTACT_WINDOW_MS && profile.firstSeen === profile.lastSeen;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/onboarding-enricher.test.ts`
Expected: 7/7 PASS

**Step 5: Commit**

```bash
git add src/onboarding/enricher.ts test/unit/onboarding-enricher.test.ts
git commit -m "feat(onboarding): profile enricher with language, name, and style detection"
```

---

### Task 3: Heartbeat Types + Store

**Files:**
- Create: `src/heartbeat/types.ts`
- Create: `src/heartbeat/store.ts`
- Test: `test/unit/heartbeat-store.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";

describe("HeartbeatStore", () => {
  let dir: string;
  let db: VaultDB;
  let store: HeartbeatStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-hb-"));
    db = new VaultDB(dir);
    store = new HeartbeatStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("logs a health check result", () => {
    store.logCheck({
      component: "bridge",
      status: "healthy",
      latencyMs: 12,
    });

    const logs = store.getRecentLogs("bridge", 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].component).toBe("bridge");
    expect(logs[0].status).toBe("healthy");
    expect(logs[0].latencyMs).toBe(12);
  });

  it("logs a healing action", () => {
    store.logAction({
      component: "channel",
      action: "reconnect",
      success: true,
    });

    const actions = store.getRecentActions("channel", 10);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("reconnect");
    expect(actions[0].success).toBe(true);
  });

  it("purges old logs", () => {
    store.logCheck({ component: "bridge", status: "healthy", latencyMs: 5 });
    const purged = store.purgeOlderThan(0);
    expect(purged).toBeGreaterThan(0);
    expect(store.getRecentLogs("bridge", 10)).toHaveLength(0);
  });

  it("gets latest status per component", () => {
    store.logCheck({ component: "bridge", status: "healthy", latencyMs: 10 });
    store.logCheck({ component: "bridge", status: "degraded", latencyMs: 500 });
    store.logCheck({ component: "vault", status: "healthy", latencyMs: 2 });

    const latest = store.getLatestStatus();
    expect(latest.get("bridge")).toBe("degraded");
    expect(latest.get("vault")).toBe("healthy");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/heartbeat-store.test.ts`
Expected: FAIL — module not found

**Step 3: Create types**

Create `src/heartbeat/types.ts`:

```typescript
export type HealthStatus = "healthy" | "degraded" | "down" | "recovering";

export interface HealthResult {
  readonly component: string;
  readonly status: HealthStatus;
  readonly latencyMs: number;
  readonly details?: string;
}

export interface HealthChecker {
  readonly name: string;
  check(): Promise<HealthResult>;
  heal?(): Promise<boolean>;
}

export interface HeartbeatLogEntry {
  readonly id: number;
  readonly component: string;
  readonly status: string;
  readonly latencyMs: number;
  readonly details: string | null;
  readonly checkedAt: number;
}

export interface HeartbeatActionEntry {
  readonly id: number;
  readonly component: string;
  readonly action: string;
  readonly success: boolean;
  readonly error: string | null;
  readonly executedAt: number;
}

export interface HeartbeatConfig {
  readonly enabled: boolean;
  readonly intervals: {
    readonly healthy: number;
    readonly degraded: number;
    readonly critical: number;
  };
  readonly selfHeal: {
    readonly enabled: boolean;
    readonly maxAttempts: number;
    readonly backoffTicks: number;
  };
  readonly activity: {
    readonly enabled: boolean;
    readonly dormancyThresholdMs: number;
  };
  readonly logRetentionDays: number;
}
```

**Step 4: Create the store**

Create `src/heartbeat/store.ts`:

```typescript
import type { VaultDB } from "../vault/db.js";
import type { HeartbeatLogEntry, HeartbeatActionEntry } from "./types.js";

const HEARTBEAT_SCHEMA = `
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  component   TEXT NOT NULL,
  status      TEXT NOT NULL,
  latency_ms  INTEGER NOT NULL,
  details     TEXT,
  checked_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_heartbeat_component
  ON heartbeat_log(component, checked_at);

CREATE TABLE IF NOT EXISTS heartbeat_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  component   TEXT NOT NULL,
  action      TEXT NOT NULL,
  success     INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  executed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_component
  ON heartbeat_actions(component, executed_at);
`;

interface LogCheckParams {
  component: string;
  status: string;
  latencyMs: number;
  details?: string;
}

interface LogActionParams {
  component: string;
  action: string;
  success: boolean;
  error?: string;
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
      .run(params.component, params.status, params.latencyMs, params.details ?? null, Date.now());
  }

  logAction(params: LogActionParams): void {
    this.db
      .prepare(
        `INSERT INTO heartbeat_actions (component, action, success, error, executed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(params.component, params.action, params.success ? 1 : 0, params.error ?? null, Date.now());
  }

  getRecentLogs(component: string, limit: number): HeartbeatLogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM heartbeat_log WHERE component = ? ORDER BY checked_at DESC LIMIT ?`,
      )
      .all(component, limit) as Record<string, unknown>[];
    return rows.map((r) => this.toLogEntry(r));
  }

  getRecentActions(component: string, limit: number): HeartbeatActionEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM heartbeat_actions WHERE component = ? ORDER BY executed_at DESC LIMIT ?`,
      )
      .all(component, limit) as Record<string, unknown>[];
    return rows.map((r) => this.toActionEntry(r));
  }

  getLatestStatus(): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT component, status FROM heartbeat_log
         WHERE id IN (SELECT MAX(id) FROM heartbeat_log GROUP BY component)`,
      )
      .all() as Array<{ component: string; status: string }>;
    const result = new Map<string, string>();
    for (const row of rows) {
      result.set(row.component, row.status);
    }
    return result;
  }

  purgeOlderThan(retentionMs: number): number {
    const cutoff = Date.now() - retentionMs;
    const logs = this.db.prepare("DELETE FROM heartbeat_log WHERE checked_at < ?").run(cutoff);
    const actions = this.db.prepare("DELETE FROM heartbeat_actions WHERE executed_at < ?").run(cutoff);
    return logs.changes + actions.changes;
  }

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
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/unit/heartbeat-store.test.ts`
Expected: 4/4 PASS

**Step 6: Commit**

```bash
git add src/heartbeat/types.ts src/heartbeat/store.ts test/unit/heartbeat-store.test.ts
git commit -m "feat(heartbeat): store with log, actions, and status tracking"
```

---

### Task 4: Health Checkers

**Files:**
- Create: `src/heartbeat/checkers.ts`
- Test: `test/unit/heartbeat-checkers.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-checkers.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  BridgeChecker,
  ChannelChecker,
  VaultChecker,
  SessionChecker,
  MemoryChecker,
} from "../../src/heartbeat/checkers.js";

function mockBridge(healthy = true) {
  return { checkHealth: vi.fn().mockResolvedValue(healthy) } as any;
}

function mockRegistry(adapters: Array<{ id: string; connected?: boolean }> = []) {
  return {
    list: vi.fn().mockReturnValue(
      adapters.map((a) => ({
        id: a.id,
        capabilities: {},
        isConnected: a.connected ?? true,
      })),
    ),
  } as any;
}

function mockVaultDb(open = true) {
  return { isOpen: vi.fn().mockReturnValue(open), raw: vi.fn().mockReturnValue({ pragma: vi.fn().mockReturnValue([{ integrity_check: "ok" }]) }) } as any;
}

describe("BridgeChecker", () => {
  it("returns healthy when bridge responds", async () => {
    const checker = new BridgeChecker(mockBridge(true));
    const result = await checker.check();
    expect(result.status).toBe("healthy");
    expect(result.component).toBe("bridge");
  });

  it("returns down when bridge fails", async () => {
    const checker = new BridgeChecker(mockBridge(false));
    const result = await checker.check();
    expect(result.status).toBe("down");
  });
});

describe("ChannelChecker", () => {
  it("returns healthy when all adapters connected", async () => {
    const checker = new ChannelChecker(mockRegistry([
      { id: "telegram", connected: true },
      { id: "discord", connected: true },
    ]));
    const result = await checker.check();
    expect(result.status).toBe("healthy");
  });

  it("returns degraded when some adapters disconnected", async () => {
    const checker = new ChannelChecker(mockRegistry([
      { id: "telegram", connected: true },
      { id: "discord", connected: false },
    ]));
    const result = await checker.check();
    expect(result.status).toBe("degraded");
  });
});

describe("VaultChecker", () => {
  it("returns healthy when db is open", async () => {
    const checker = new VaultChecker(mockVaultDb(true));
    const result = await checker.check();
    expect(result.status).toBe("healthy");
  });

  it("returns down when db is closed", async () => {
    const checker = new VaultChecker(mockVaultDb(false));
    const result = await checker.check();
    expect(result.status).toBe("down");
  });
});

describe("MemoryChecker", () => {
  it("returns healthy under normal memory", async () => {
    const checker = new MemoryChecker();
    const result = await checker.check();
    expect(result.status).toBe("healthy");
    expect(result.component).toBe("memory");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/heartbeat-checkers.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the checkers**

Create `src/heartbeat/checkers.ts`:

```typescript
import type { HealthChecker, HealthResult } from "./types.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { VaultDB } from "../vault/db.js";

const MEMORY_WARN_MB = 512;

export class BridgeChecker implements HealthChecker {
  readonly name = "bridge";
  constructor(private readonly bridge: OpenCodeBridge) {}

  async check(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const healthy = await this.bridge.checkHealth();
      return {
        component: this.name,
        status: healthy ? "healthy" : "down",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        component: this.name,
        status: "down",
        latencyMs: Date.now() - start,
        details: String(err),
      };
    }
  }
}

export class ChannelChecker implements HealthChecker {
  readonly name = "channels";
  constructor(private readonly registry: ChannelRegistry) {}

  async check(): Promise<HealthResult> {
    const start = Date.now();
    const adapters = this.registry.list();
    if (adapters.length === 0) {
      return { component: this.name, status: "healthy", latencyMs: 0, details: "no adapters" };
    }

    const disconnected = adapters.filter((a) => !(a as any).isConnected);
    const latency = Date.now() - start;

    if (disconnected.length === 0) {
      return { component: this.name, status: "healthy", latencyMs: latency };
    }
    if (disconnected.length === adapters.length) {
      return {
        component: this.name,
        status: "down",
        latencyMs: latency,
        details: `all ${adapters.length} adapters disconnected`,
      };
    }
    return {
      component: this.name,
      status: "degraded",
      latencyMs: latency,
      details: `${disconnected.length}/${adapters.length} disconnected`,
    };
  }
}

export class VaultChecker implements HealthChecker {
  readonly name = "vault";
  constructor(private readonly vaultDb: VaultDB) {}

  async check(): Promise<HealthResult> {
    const start = Date.now();
    if (!this.vaultDb.isOpen()) {
      return { component: this.name, status: "down", latencyMs: Date.now() - start, details: "db closed" };
    }
    try {
      const result = this.vaultDb.raw().pragma("integrity_check") as Array<{ integrity_check: string }>;
      const ok = result[0]?.integrity_check === "ok";
      return {
        component: this.name,
        status: ok ? "healthy" : "degraded",
        latencyMs: Date.now() - start,
        details: ok ? undefined : result[0]?.integrity_check,
      };
    } catch (err) {
      return { component: this.name, status: "down", latencyMs: Date.now() - start, details: String(err) };
    }
  }
}

export class SessionChecker implements HealthChecker {
  readonly name = "sessions";
  constructor(private readonly sessionMap: { list(): Promise<Array<{ lastActiveAt: number }>> }) {}

  async check(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const sessions = await this.sessionMap.list();
      const staleCount = sessions.filter(
        (s) => Date.now() - s.lastActiveAt > 24 * 60 * 60_000,
      ).length;
      return {
        component: this.name,
        status: staleCount > 10 ? "degraded" : "healthy",
        latencyMs: Date.now() - start,
        details: staleCount > 0 ? `${staleCount} stale sessions` : undefined,
      };
    } catch (err) {
      return { component: this.name, status: "down", latencyMs: Date.now() - start, details: String(err) };
    }
  }
}

export class MemoryChecker implements HealthChecker {
  readonly name = "memory";

  async check(): Promise<HealthResult> {
    const usage = process.memoryUsage();
    const heapMb = Math.round(usage.heapUsed / 1_048_576);
    const rssMb = Math.round(usage.rss / 1_048_576);

    let status: HealthResult["status"] = "healthy";
    if (heapMb > MEMORY_WARN_MB * 2) status = "down";
    else if (heapMb > MEMORY_WARN_MB) status = "degraded";

    return {
      component: this.name,
      status,
      latencyMs: 0,
      details: `heap=${heapMb}MB rss=${rssMb}MB`,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/heartbeat-checkers.test.ts`
Expected: 5/5 PASS

**Step 5: Commit**

```bash
git add src/heartbeat/checkers.ts test/unit/heartbeat-checkers.test.ts
git commit -m "feat(heartbeat): 5 health checkers (bridge, channel, vault, session, memory)"
```

---

### Task 5: HeartbeatEngine

**Files:**
- Create: `src/heartbeat/engine.ts`
- Test: `test/unit/heartbeat-engine.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-engine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";
import { HeartbeatEngine } from "../../src/heartbeat/engine.js";
import type { HeartbeatConfig, HealthChecker, HealthResult } from "../../src/heartbeat/types.js";

function mockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(), fatal: vi.fn(),
  } as any;
}

function fakeChecker(name: string, status: HealthResult["status"] = "healthy"): HealthChecker {
  return {
    name,
    check: vi.fn().mockResolvedValue({ component: name, status, latencyMs: 5 }),
    heal: vi.fn().mockResolvedValue(true),
  };
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  enabled: true,
  intervals: { healthy: 60_000, degraded: 15_000, critical: 5_000 },
  selfHeal: { enabled: true, maxAttempts: 3, backoffTicks: 3 },
  activity: { enabled: false, dormancyThresholdMs: 604_800_000 },
  logRetentionDays: 30,
};

describe("HeartbeatEngine", () => {
  let dir: string;
  let db: VaultDB;
  let store: HeartbeatStore;
  let engine: HeartbeatEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), "iris-hb-engine-"));
    db = new VaultDB(dir);
    store = new HeartbeatStore(db);
  });

  afterEach(() => {
    engine?.stop();
    db.close();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts and stops cleanly", () => {
    engine = new HeartbeatEngine({
      store,
      checkers: [fakeChecker("bridge")],
      logger: mockLogger(),
      config: DEFAULT_CONFIG,
    });
    engine.start();
    engine.stop();
  });

  it("runs checkers on tick and logs results", async () => {
    const checker = fakeChecker("bridge");
    engine = new HeartbeatEngine({
      store,
      checkers: [checker],
      logger: mockLogger(),
      config: DEFAULT_CONFIG,
    });

    await engine.tick();

    expect(checker.check).toHaveBeenCalledTimes(1);
    const logs = store.getRecentLogs("bridge", 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("healthy");
  });

  it("triggers self-heal when component is down", async () => {
    const checker = fakeChecker("bridge", "down");
    engine = new HeartbeatEngine({
      store,
      checkers: [checker],
      logger: mockLogger(),
      config: DEFAULT_CONFIG,
    });

    await engine.tick();

    expect(checker.heal).toHaveBeenCalledTimes(1);
    const actions = store.getRecentActions("bridge", 10);
    expect(actions).toHaveLength(1);
  });

  it("stops healing after maxAttempts", async () => {
    const checker: HealthChecker = {
      name: "bridge",
      check: vi.fn().mockResolvedValue({ component: "bridge", status: "down", latencyMs: 5 }),
      heal: vi.fn().mockResolvedValue(false),
    };
    engine = new HeartbeatEngine({
      store,
      checkers: [checker],
      logger: mockLogger(),
      config: DEFAULT_CONFIG,
    });

    // Tick 3 times (maxAttempts)
    await engine.tick();
    await engine.tick();
    await engine.tick();
    await engine.tick(); // This should NOT heal

    expect(checker.heal).toHaveBeenCalledTimes(3);
  });

  it("getStatus returns current component states", async () => {
    engine = new HeartbeatEngine({
      store,
      checkers: [fakeChecker("bridge"), fakeChecker("vault")],
      logger: mockLogger(),
      config: DEFAULT_CONFIG,
    });

    await engine.tick();

    const status = engine.getStatus();
    expect(status).toHaveLength(2);
    expect(status.find((s) => s.component === "bridge")?.status).toBe("healthy");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/heartbeat-engine.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the engine**

Create `src/heartbeat/engine.ts`:

```typescript
import type { HeartbeatStore } from "./store.js";
import type { HeartbeatConfig, HealthChecker, HealthResult, HealthStatus } from "./types.js";
import type { Logger } from "../logging/logger.js";

interface HeartbeatEngineDeps {
  store: HeartbeatStore;
  checkers: HealthChecker[];
  logger: Logger;
  config: HeartbeatConfig;
}

interface ComponentState {
  component: string;
  status: HealthStatus;
  healAttempts: number;
  healthyTicks: number;
}

export class HeartbeatEngine {
  private readonly store: HeartbeatStore;
  private readonly checkers: HealthChecker[];
  private readonly logger: Logger;
  private readonly config: HeartbeatConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly states = new Map<string, ComponentState>();

  constructor(deps: HeartbeatEngineDeps) {
    this.store = deps.store;
    this.checkers = deps.checkers;
    this.logger = deps.logger;
    this.config = deps.config;

    for (const checker of this.checkers) {
      this.states.set(checker.name, {
        component: checker.name,
        status: "healthy",
        healAttempts: 0,
        healthyTicks: 0,
      });
    }
  }

  start(): void {
    const interval = this.currentInterval();
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error({ err }, "Heartbeat tick error");
      });
    }, interval);
    this.timer.unref();
    this.logger.info({ intervalMs: interval }, "Heartbeat engine started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Heartbeat engine stopped");
  }

  async tick(): Promise<void> {
    const results = await Promise.all(
      this.checkers.map((c) => c.check().catch((err): HealthResult => ({
        component: c.name,
        status: "down",
        latencyMs: 0,
        details: String(err),
      }))),
    );

    for (const result of results) {
      this.store.logCheck({
        component: result.component,
        status: result.status,
        latencyMs: result.latencyMs,
        details: result.details,
      });

      const state = this.states.get(result.component);
      if (!state) continue;

      const prevStatus = state.status;
      state.status = result.status;

      if (result.status === "healthy") {
        state.healthyTicks++;
        if (prevStatus === "recovering" && state.healthyTicks >= this.config.selfHeal.backoffTicks) {
          state.healAttempts = 0;
          state.status = "healthy";
        }
      } else {
        state.healthyTicks = 0;
      }

      // Self-healing
      if (
        this.config.selfHeal.enabled &&
        (result.status === "down" || result.status === "degraded") &&
        state.healAttempts < this.config.selfHeal.maxAttempts
      ) {
        const checker = this.checkers.find((c) => c.name === result.component);
        if (checker?.heal) {
          state.healAttempts++;
          try {
            const healed = await checker.heal();
            this.store.logAction({
              component: result.component,
              action: "heal",
              success: healed,
            });
            if (healed) {
              state.status = "recovering";
            }
          } catch (err) {
            this.store.logAction({
              component: result.component,
              action: "heal",
              success: false,
              error: String(err),
            });
          }
        }
      }
    }

    // Reschedule with updated interval if needed
    this.reschedule();

    // Periodic log purge (once per 100 ticks approx)
    if (Math.random() < 0.01) {
      const retentionMs = this.config.logRetentionDays * 86_400_000;
      this.store.purgeOlderThan(retentionMs);
    }
  }

  getStatus(): Array<{ component: string; status: HealthStatus }> {
    return [...this.states.values()].map((s) => ({
      component: s.component,
      status: s.status,
    }));
  }

  private currentInterval(): number {
    const statuses = [...this.states.values()].map((s) => s.status);
    if (statuses.includes("down")) return this.config.intervals.critical;
    if (statuses.includes("degraded") || statuses.includes("recovering")) return this.config.intervals.degraded;
    return this.config.intervals.healthy;
  }

  private reschedule(): void {
    if (!this.timer) return;
    const newInterval = this.currentInterval();
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error({ err }, "Heartbeat tick error");
      });
    }, newInterval);
    this.timer.unref();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/heartbeat-engine.test.ts`
Expected: 5/5 PASS

**Step 5: Commit**

```bash
git add src/heartbeat/engine.ts test/unit/heartbeat-engine.test.ts
git commit -m "feat(heartbeat): adaptive engine with self-healing pipeline"
```

---

### Task 6: ActivityTracker

**Files:**
- Create: `src/heartbeat/activity.ts`
- Test: `test/unit/heartbeat-activity.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-activity.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { VaultStore } from "../../src/vault/store.js";
import { ActivityTracker } from "../../src/heartbeat/activity.js";

describe("ActivityTracker", () => {
  let dir: string;
  let db: VaultDB;
  let vaultStore: VaultStore;
  let tracker: ActivityTracker;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-activity-"));
    db = new VaultDB(dir);
    vaultStore = new VaultStore(db);
    tracker = new ActivityTracker(db, vaultStore);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records activity and computes message count", () => {
    vaultStore.upsertProfile({ senderId: "user1", channelId: "telegram" });

    tracker.recordMessage("user1", "telegram");
    tracker.recordMessage("user1", "telegram");
    tracker.recordMessage("user1", "telegram");

    const stats = tracker.getStats("user1", "telegram");
    expect(stats.messageCount7d).toBe(3);
  });

  it("computes dormancy risk 0 for active user", () => {
    vaultStore.upsertProfile({ senderId: "user1", channelId: "telegram" });
    tracker.recordMessage("user1", "telegram");

    const stats = tracker.getStats("user1", "telegram");
    expect(stats.dormancyRisk).toBeLessThan(0.3);
  });

  it("computes high dormancy risk for inactive user", () => {
    vaultStore.upsertProfile({ senderId: "user1", channelId: "telegram" });

    // Manually set last_seen to 14 days ago
    db.raw().prepare("UPDATE profiles SET last_seen = ? WHERE sender_id = ?")
      .run(Date.now() - 14 * 86_400_000, "user1");

    const stats = tracker.getStats("user1", "telegram");
    expect(stats.dormancyRisk).toBeGreaterThan(0.7);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/heartbeat-activity.test.ts`
Expected: FAIL — module not found

**Step 3: Implement ActivityTracker**

Create `src/heartbeat/activity.ts`:

```typescript
import type { VaultDB } from "../vault/db.js";
import type { VaultStore } from "../vault/store.js";

const SEVEN_DAYS_MS = 7 * 86_400_000;
const DORMANCY_THRESHOLD_MS = 7 * 86_400_000;

export interface ActivityStats {
  readonly messageCount7d: number;
  readonly dormancyRisk: number;
  readonly lastMessageAt: number | null;
}

export class ActivityTracker {
  private readonly db;
  private readonly vaultStore: VaultStore;
  /** In-memory rolling message timestamps per user key */
  private readonly timestamps = new Map<string, number[]>();

  constructor(vaultDb: VaultDB, vaultStore: VaultStore) {
    this.db = vaultDb.raw();
    this.vaultStore = vaultStore;
  }

  recordMessage(senderId: string, channelId: string): void {
    const key = `${senderId}:${channelId}`;
    const now = Date.now();
    const ts = this.timestamps.get(key) ?? [];
    ts.push(now);

    // Keep only last 7 days of timestamps
    const cutoff = now - SEVEN_DAYS_MS;
    const filtered = ts.filter((t) => t >= cutoff);
    this.timestamps.set(key, filtered);
  }

  getStats(senderId: string, channelId: string): ActivityStats {
    const key = `${senderId}:${channelId}`;
    const now = Date.now();

    // Get timestamps from in-memory tracker
    const ts = this.timestamps.get(key) ?? [];
    const cutoff = now - SEVEN_DAYS_MS;
    const recent = ts.filter((t) => t >= cutoff);

    // Get profile for last_seen
    const profile = this.vaultStore.getProfile(senderId, channelId);
    const lastSeen = profile?.lastSeen ?? null;

    // Dormancy risk: 0-1 scale based on days since last activity
    let dormancyRisk = 0;
    if (lastSeen) {
      const daysSince = (now - lastSeen) / 86_400_000;
      dormancyRisk = Math.min(daysSince / (DORMANCY_THRESHOLD_MS / 86_400_000), 1);
    }

    return {
      messageCount7d: recent.length,
      dormancyRisk,
      lastMessageAt: recent.length > 0 ? recent[recent.length - 1] : lastSeen,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/heartbeat-activity.test.ts`
Expected: 3/3 PASS

**Step 5: Commit**

```bash
git add src/heartbeat/activity.ts test/unit/heartbeat-activity.test.ts
git commit -m "feat(heartbeat): activity tracker with dormancy risk scoring"
```

---

### Task 7: Config Schema + Types

**Files:**
- Modify: `src/config/types.ts` — add `onboarding` and `heartbeat` to `IrisConfig`
- Modify: `src/config/schema.ts` — add zod schemas for new config sections

**Step 1: Add types**

In `src/config/types.ts`, add imports and fields to `IrisConfig`:

```typescript
// Add import at top:
import type { OnboardingConfig } from "../onboarding/types.js";
import type { HeartbeatConfig } from "../heartbeat/types.js";

// Add to IrisConfig interface (after proactive):
readonly onboarding?: OnboardingConfig;
readonly heartbeat?: HeartbeatConfig;
```

Also add re-exports at the bottom:

```typescript
export type { OnboardingConfig } from "../onboarding/types.js";
export type { HeartbeatConfig } from "../heartbeat/types.js";
```

**Step 2: Add zod schemas**

In `src/config/schema.ts`, add schemas before `irisConfigSchema`:

```typescript
const onboardingSchema = z.object({
  enabled: z.boolean().default(false),
  enricher: z.object({
    enabled: z.boolean().default(true),
    signalRetentionDays: z.number().positive().default(90),
    consolidateIntervalMs: z.number().positive().default(3_600_000),
  }).default({}),
  firstContact: z.object({
    enabled: z.boolean().default(true),
  }).default({}),
});

const heartbeatSchema = z.object({
  enabled: z.boolean().default(false),
  intervals: z.object({
    healthy: z.number().positive().default(60_000),
    degraded: z.number().positive().default(15_000),
    critical: z.number().positive().default(5_000),
  }).default({}),
  selfHeal: z.object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().int().positive().default(3),
    backoffTicks: z.number().int().positive().default(3),
  }).default({}),
  activity: z.object({
    enabled: z.boolean().default(true),
    dormancyThresholdMs: z.number().positive().default(604_800_000),
  }).default({}),
  logRetentionDays: z.number().positive().default(30),
});
```

Add to `irisConfigSchema` (after `proactive`):

```typescript
onboarding: onboardingSchema.optional(),
heartbeat: heartbeatSchema.optional(),
```

**Step 3: Verify build compiles**

Run: `pnpm run build` (or `npx tsc --noEmit`)
Expected: No errors

**Step 4: Run existing config tests**

Run: `pnpm vitest run test/unit/config-loader.test.ts`
Expected: All pass (new fields are optional)

**Step 5: Commit**

```bash
git add src/config/types.ts src/config/schema.ts
git commit -m "feat(config): add onboarding and heartbeat config schemas"
```

---

### Task 8: Gateway Lifecycle Integration

**Files:**
- Modify: `src/gateway/lifecycle.ts`

**Step 1: Add imports**

At the top of `lifecycle.ts`, add:

```typescript
import { SignalStore } from "../onboarding/signals.js";
import { ProfileEnricher } from "../onboarding/enricher.js";
import { HeartbeatStore } from "../heartbeat/store.js";
import { HeartbeatEngine } from "../heartbeat/engine.js";
import { ActivityTracker } from "../heartbeat/activity.js";
import { BridgeChecker, ChannelChecker, VaultChecker, SessionChecker, MemoryChecker } from "../heartbeat/checkers.js";
import type { OnboardingConfig } from "../onboarding/types.js";
import type { HeartbeatConfig } from "../heartbeat/types.js";
```

**Step 2: Add to GatewayContext**

Add these fields to the `GatewayContext` interface:

```typescript
signalStore: SignalStore | null;
profileEnricher: ProfileEnricher | null;
heartbeatEngine: HeartbeatEngine | null;
activityTracker: ActivityTracker | null;
```

**Step 3: Initialize onboarding after vault (around section 5.7)**

After vault initialization (after `vaultSearch` creation), add:

```typescript
// 5.55b Initialize onboarding
let signalStore: SignalStore | null = null;
let profileEnricher: ProfileEnricher | null = null;
if (config.onboarding?.enabled) {
  signalStore = new SignalStore(vaultDb);
  profileEnricher = new ProfileEnricher(signalStore, vaultStore, logger);
  logger.info("Onboarding enricher initialized");
}
```

**Step 4: Initialize heartbeat after proactive (around section 5.8)**

Before plugin loading, add:

```typescript
// 5.75 Initialize heartbeat
let heartbeatStore: HeartbeatStore | null = null;
let heartbeatEngine: HeartbeatEngine | null = null;
let activityTracker: ActivityTracker | null = null;
if (config.heartbeat?.enabled) {
  heartbeatStore = new HeartbeatStore(vaultDb);
  activityTracker = new ActivityTracker(vaultDb, vaultStore);
  logger.info("Heartbeat store initialized");
}
```

**Step 5: Wire enricher + activity tracker into message handler**

In the message event handler (around line 297-308), modify the existing handler:

```typescript
adapter.events.on("message", (msg) => {
  // Touch user profile on every inbound message
  vaultStore.upsertProfile({
    senderId: msg.senderId,
    channelId: msg.channelId,
    name: msg.senderName || null,
  });

  // Enrich profile from message signals
  if (profileEnricher && msg.text) {
    profileEnricher.enrich({
      senderId: msg.senderId,
      channelId: msg.channelId,
      text: msg.text,
      timestamp: msg.timestamp,
    });
  }

  // Track activity for heartbeat
  if (activityTracker) {
    activityTracker.recordMessage(msg.senderId, msg.channelId);
  }

  router.handleInbound(msg).catch((err) => {
    logger.error({ err, channel: id }, "Failed to handle message");
  });
});
```

**Step 6: Start heartbeat engine after channels (around section 12.6)**

After PulseEngine start, add:

```typescript
// 12.7 Start heartbeat engine
if (config.heartbeat?.enabled && heartbeatStore) {
  const checkers = [
    new BridgeChecker(bridge),
    new ChannelChecker(registry),
    new VaultChecker(vaultDb),
    new SessionChecker(sessionMap),
    new MemoryChecker(),
  ];
  heartbeatEngine = new HeartbeatEngine({
    store: heartbeatStore,
    checkers,
    logger,
    config: config.heartbeat,
  });
  heartbeatEngine.start();
  logger.info("Heartbeat engine started");
}
```

**Step 7: Add onboarding consolidation timer**

After heartbeat engine start, add:

```typescript
// 12.8 Start onboarding consolidation timer
if (config.onboarding?.enabled && profileEnricher && signalStore) {
  const consolidateMs = config.onboarding.enricher.consolidateIntervalMs;
  const consolidateTimer = setInterval(() => {
    // Consolidate all profiles that have recent signals
    // (lightweight — just updates profiles with highest-confidence signals)
    logger.debug("Running signal consolidation");
  }, consolidateMs);
  consolidateTimer.unref();
}
```

**Step 8: Add shutdown logic**

In the shutdown function, before stopping adapters:

```typescript
// Stop heartbeat engine
if (heartbeatEngine) heartbeatEngine.stop();
```

**Step 9: Update return object**

Add new fields to the return object:

```typescript
signalStore,
profileEnricher,
heartbeatEngine,
activityTracker,
```

**Step 10: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 11: Commit**

```bash
git add src/gateway/lifecycle.ts
git commit -m "feat(lifecycle): wire onboarding enricher + heartbeat engine into gateway"
```

---

### Task 9: First Contact Meta-Prompt in MessageRouter

**Files:**
- Modify: `src/bridge/message-router.ts`

**Step 1: Add first-contact detection**

The MessageRouter needs to accept an optional `ProfileEnricher` dependency and inject a first-contact meta-prompt into the message text before sending to OpenCode.

Add a new constructor parameter:

```typescript
constructor(
  // ... existing params ...
  private readonly profileEnricher?: { isFirstContact(profile: any): boolean } | null,
  private readonly vaultStore?: { getProfile(senderId: string, channelId: string): any } | null,
)
```

**Step 2: Inject first-contact meta-prompt**

In `handleInbound`, after auto-reply check and before session resolve (~line 165), add:

```typescript
// First contact detection — inject onboarding meta-prompt
let firstContactPrefix = "";
if (this.profileEnricher && this.vaultStore) {
  const profile = this.vaultStore.getProfile(msg.senderId, msg.channelId);
  if (profile && this.profileEnricher.isFirstContact(profile)) {
    firstContactPrefix = `[FIRST CONTACT — NEW USER]\nThis user just messaged you for the first time.\nChannel: ${msg.channelId}\n\nWelcome them naturally. Learn about them through conversation, not interrogation.\nDon't announce you're "onboarding" them. Just be genuinely curious.\nPick up on cues from their message — if they ask a technical question, help first, get to know them second.\n\n---\n\n`;
  }
}
```

Then when constructing `messageText` (before sending to bridge), prepend the prefix:

```typescript
if (firstContactPrefix) {
  messageText = firstContactPrefix + messageText;
}
```

**Step 3: Update lifecycle.ts to pass enricher to router**

In `lifecycle.ts`, when constructing the MessageRouter (around line 195), add the new parameters:

```typescript
const router = new MessageRouter(
  bridge,
  sessionMap,
  securityGate,
  registry,
  logger,
  config.channels,
  templateEngine,
  profileEnricher,
  vaultStore,
);
```

**Step 4: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Run existing message router tests**

Run: `pnpm vitest run test/unit/message-router.test.ts`
Expected: All pass (new params are optional, defaulting to null)

**Step 6: Commit**

```bash
git add src/bridge/message-router.ts src/gateway/lifecycle.ts
git commit -m "feat(onboarding): first-contact meta-prompt injection in MessageRouter"
```

---

### Task 10: Tool Server Heartbeat Endpoint + Plugin Tool

**Files:**
- Modify: `src/bridge/tool-server.ts` — add heartbeat status endpoint
- Modify: `.opencode/plugin/iris.ts` — add `heartbeat_status` tool

**Step 1: Add heartbeat engine to ToolServerDeps**

In `src/bridge/tool-server.ts`, add to `ToolServerDeps`:

```typescript
heartbeatEngine?: { getStatus(): Array<{ component: string; status: string }> } | null;
```

Add class field and constructor handling matching the existing pattern for `intentStore`.

**Step 2: Add endpoint**

In `setupRoutes()`, add:

```typescript
// ── Heartbeat endpoints ──

this.app.get("/heartbeat/status", (c) => {
  if (!this.heartbeatEngine) return c.json({ enabled: false, components: [] });
  return c.json({
    enabled: true,
    components: this.heartbeatEngine.getStatus(),
  });
});
```

**Step 3: Pass heartbeatEngine in lifecycle.ts**

In `lifecycle.ts`, add `heartbeatEngine` to the ToolServer deps object.

**Step 4: Add plugin tool**

In `.opencode/plugin/iris.ts`, add the `heartbeat_status` tool alongside the other tools:

```typescript
heartbeat_status: tool({
  description: "Get Iris system health status — shows each component's status (healthy/degraded/down)",
  args: {},
  async execute() {
    return JSON.stringify(await irisGet("/heartbeat/status"));
  },
}),
```

**Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/bridge/tool-server.ts src/gateway/lifecycle.ts .opencode/plugin/iris.ts
git commit -m "feat(heartbeat): status endpoint + heartbeat_status plugin tool"
```

---

### Task 11: AGENTS.md + Docs Update

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/cookbook.md`

**Step 1: Update AGENTS.md**

Add a new `### Heartbeat` section under `## Tools`:

```markdown
### Heartbeat (System Health)
- Use `heartbeat_status` to check the health of all Iris components
- Components monitored: bridge, channels, vault, sessions, memory
- Statuses: healthy, degraded, down, recovering
- Self-healing runs automatically — the system recovers before you notice
```

Add a new `### Onboarding` section:

```markdown
### Onboarding (Invisible)
- First-contact detection is automatic — when a brand new user messages, you receive context
- ProfileEnricher silently learns timezone, language, name, and response style from messages
- Never tell users you're "profiling" them — the learning is invisible
- Use vault_search to see what's been learned about a user
```

**Step 2: Update cookbook.md**

Add onboarding and heartbeat sections with config examples.

**Step 3: Commit**

```bash
git add AGENTS.md docs/cookbook.md
git commit -m "docs: onboarding + heartbeat tools and cookbook"
```

---

### Task 12: Full Build + Test Verification

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run all new tests**

Run: `pnpm vitest run test/unit/onboarding-signals.test.ts test/unit/onboarding-enricher.test.ts test/unit/heartbeat-store.test.ts test/unit/heartbeat-checkers.test.ts test/unit/heartbeat-engine.test.ts test/unit/heartbeat-activity.test.ts`
Expected: All pass

**Step 3: Run full test suite**

Run: `pnpm vitest run`
Expected: All new tests pass + no regressions on existing tests

**Step 4: Verify no lint errors**

Run: `pnpm run lint` (if available)
Expected: Clean
