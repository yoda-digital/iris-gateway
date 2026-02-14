# Heartbeat V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring six OpenClaw heartbeat advantages to Iris: active hours gating, per-channel visibility, alert deduplication, empty-check with exponential backoff, full multi-agent independence, and coalescing with queue awareness.

**Architecture:** Modular Companions pattern — each feature is a separate pure-function module that the HeartbeatEngine orchestrator imports and composes. New files for each feature, additive config/storage changes, then engine refactor to integrate everything. Matches existing Iris patterns (checkers are already separate modules).

**Tech Stack:** TypeScript (ESM), Zod (config validation), SQLite via better-sqlite3 (dedup table), Vitest (tests), Intl.DateTimeFormat (timezone resolution).

---

### Task 1: Create `active-hours.ts` module

**Files:**
- Create: `src/heartbeat/active-hours.ts`
- Create: `test/unit/heartbeat-active-hours.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-active-hours.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { isWithinActiveHours } from "../../src/heartbeat/active-hours.js";

describe("isWithinActiveHours", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("returns true when no config provided", () => {
    expect(isWithinActiveHours(undefined)).toBe(true);
  });

  it("returns true within active window", () => {
    // 2026-06-15 14:00 UTC = 17:00 Europe/Chisinau (UTC+3)
    vi.setSystemTime(new Date("2026-06-15T14:00:00Z"));
    expect(isWithinActiveHours({ start: "09:00", end: "22:00", timezone: "Europe/Chisinau" })).toBe(true);
  });

  it("returns false outside active window", () => {
    // 2026-06-15 04:00 UTC = 07:00 Europe/Chisinau (UTC+3)
    vi.setSystemTime(new Date("2026-06-15T04:00:00Z"));
    expect(isWithinActiveHours({ start: "09:00", end: "22:00", timezone: "Europe/Chisinau" })).toBe(false);
  });

  it("handles overnight window (start > end)", () => {
    // 2026-06-15 01:00 UTC = 04:00 Europe/Chisinau — inside 22:00-06:00
    vi.setSystemTime(new Date("2026-06-15T01:00:00Z"));
    expect(isWithinActiveHours({ start: "22:00", end: "06:00", timezone: "Europe/Chisinau" })).toBe(true);
  });

  it("falls back to UTC on invalid timezone", () => {
    vi.setSystemTime(new Date("2026-06-15T14:00:00Z"));
    expect(isWithinActiveHours({ start: "09:00", end: "22:00", timezone: "Invalid/Zone" })).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/heartbeat-active-hours.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/heartbeat/active-hours.ts`:

```typescript
export interface ActiveHoursConfig {
  readonly start: string;  // "HH:MM"
  readonly end: string;    // "HH:MM"
  readonly timezone: string; // IANA timezone
}

function getCurrentHourMin(timezone: string): { hour: number; minute: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const hour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
    return { hour, minute };
  } catch {
    // Invalid timezone — fall back to UTC
    const now = new Date();
    return { hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
}

function parseTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinActiveHours(config: ActiveHoursConfig | undefined): boolean {
  if (!config) return true;

  const { hour, minute } = getCurrentHourMin(config.timezone);
  const now = hour * 60 + minute;
  const start = parseTime(config.start);
  const end = parseTime(config.end);

  if (start <= end) {
    // Normal window: 09:00 - 22:00
    return now >= start && now < end;
  }
  // Overnight window: 22:00 - 06:00
  return now >= start || now < end;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/heartbeat-active-hours.test.ts`
Expected: 5 PASS

**Step 5: Commit**

```bash
git add src/heartbeat/active-hours.ts test/unit/heartbeat-active-hours.test.ts
git commit -m "feat(heartbeat): add active-hours gating module"
```

---

### Task 2: Create `visibility.ts` module

**Files:**
- Create: `src/heartbeat/visibility.ts`
- Create: `test/unit/heartbeat-visibility.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-visibility.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveVisibility, type VisibilityConfig, type ChannelVisibilityOverrides } from "../../src/heartbeat/visibility.js";

describe("resolveVisibility", () => {
  const defaults: VisibilityConfig = { showOk: false, showAlerts: true, useIndicator: true };

  it("returns global defaults when no channel override", () => {
    const result = resolveVisibility(defaults, undefined, "telegram");
    expect(result).toEqual({ showOk: false, showAlerts: true, useIndicator: true });
  });

  it("applies channel override for showAlerts", () => {
    const overrides: ChannelVisibilityOverrides = { telegram: { showAlerts: false } };
    const result = resolveVisibility(defaults, overrides, "telegram");
    expect(result.showAlerts).toBe(false);
    expect(result.showOk).toBe(false);       // Unchanged
    expect(result.useIndicator).toBe(true);   // Unchanged
  });

  it("returns defaults for channels without override", () => {
    const overrides: ChannelVisibilityOverrides = { telegram: { showAlerts: false } };
    const result = resolveVisibility(defaults, overrides, "discord");
    expect(result.showAlerts).toBe(true);
  });

  it("handles undefined global config with safe defaults", () => {
    const result = resolveVisibility(undefined, undefined, "telegram");
    expect(result).toEqual({ showOk: false, showAlerts: true, useIndicator: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/heartbeat-visibility.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/heartbeat/visibility.ts`:

```typescript
export interface VisibilityConfig {
  readonly showOk: boolean;
  readonly showAlerts: boolean;
  readonly useIndicator: boolean;
}

export type ChannelVisibilityOverrides = Record<string, Partial<VisibilityConfig>>;

const DEFAULTS: VisibilityConfig = { showOk: false, showAlerts: true, useIndicator: true };

export function resolveVisibility(
  global: VisibilityConfig | undefined,
  channelOverrides: ChannelVisibilityOverrides | undefined,
  channelId: string,
): VisibilityConfig {
  const base = global ?? DEFAULTS;
  const override = channelOverrides?.[channelId];
  if (!override) return { ...base };

  return {
    showOk: override.showOk ?? base.showOk,
    showAlerts: override.showAlerts ?? base.showAlerts,
    useIndicator: override.useIndicator ?? base.useIndicator,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/heartbeat-visibility.test.ts`
Expected: 4 PASS

**Step 5: Commit**

```bash
git add src/heartbeat/visibility.ts test/unit/heartbeat-visibility.test.ts
git commit -m "feat(heartbeat): add per-channel visibility module"
```

---

### Task 3: Create `empty-check.ts` module

**Files:**
- Create: `src/heartbeat/empty-check.ts`
- Create: `test/unit/heartbeat-empty-check.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-empty-check.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { shouldSkipEmptyCheck, computeBackoffInterval, type EmptyCheckState } from "../../src/heartbeat/empty-check.js";

describe("shouldSkipEmptyCheck", () => {
  it("returns false when disabled", () => {
    const state: EmptyCheckState = { previousHash: "", consecutiveEmpty: 0 };
    expect(shouldSkipEmptyCheck(false, state, "abc123")).toBe(false);
  });

  it("returns false when hash changes", () => {
    const state: EmptyCheckState = { previousHash: "old", consecutiveEmpty: 2 };
    const result = shouldSkipEmptyCheck(true, state, "new");
    expect(result).toBe(false);
    expect(state.consecutiveEmpty).toBe(0);
    expect(state.previousHash).toBe("new");
  });

  it("returns true when hash matches (all healthy unchanged)", () => {
    const state: EmptyCheckState = { previousHash: "abc", consecutiveEmpty: 0 };
    const result = shouldSkipEmptyCheck(true, state, "abc");
    expect(result).toBe(true);
    expect(state.consecutiveEmpty).toBe(1);
  });

  it("increments consecutiveEmpty on repeated match", () => {
    const state: EmptyCheckState = { previousHash: "abc", consecutiveEmpty: 5 };
    shouldSkipEmptyCheck(true, state, "abc");
    expect(state.consecutiveEmpty).toBe(6);
  });
});

describe("computeBackoffInterval", () => {
  it("returns base interval when consecutiveEmpty is 0", () => {
    expect(computeBackoffInterval(60_000, 0, 300_000)).toBe(60_000);
  });

  it("doubles interval per consecutive empty tick", () => {
    expect(computeBackoffInterval(60_000, 1, 300_000)).toBe(120_000);
    expect(computeBackoffInterval(60_000, 2, 300_000)).toBe(240_000);
  });

  it("caps at maxBackoffMs", () => {
    expect(computeBackoffInterval(60_000, 10, 300_000)).toBe(300_000);
  });

  it("returns base interval when maxBackoffMs is 0 (disabled)", () => {
    expect(computeBackoffInterval(60_000, 5, 0)).toBe(60_000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/heartbeat-empty-check.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/heartbeat/empty-check.ts`:

```typescript
import { createHash } from "node:crypto";
import type { HealthStatus } from "./types.js";

export interface EmptyCheckState {
  previousHash: string;
  consecutiveEmpty: number;
}

export function hashStatuses(statuses: Array<{ component: string; status: HealthStatus }>): string {
  const sorted = [...statuses].sort((a, b) => a.component.localeCompare(b.component));
  const input = sorted.map((s) => `${s.component}:${s.status}`).join("|");
  return createHash("md5").update(input).digest("hex");
}

export function shouldSkipEmptyCheck(
  enabled: boolean,
  state: EmptyCheckState,
  currentHash: string,
): boolean {
  if (!enabled) return false;

  if (currentHash !== state.previousHash) {
    state.previousHash = currentHash;
    state.consecutiveEmpty = 0;
    return false;
  }

  // Hash matches — all healthy and unchanged
  state.consecutiveEmpty++;
  return true;
}

export function computeBackoffInterval(
  baseMs: number,
  consecutiveEmpty: number,
  maxBackoffMs: number,
): number {
  if (maxBackoffMs <= 0 || consecutiveEmpty === 0) return baseMs;
  const backed = baseMs * Math.pow(2, consecutiveEmpty);
  return Math.min(backed, maxBackoffMs);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/heartbeat-empty-check.test.ts`
Expected: 8 PASS

**Step 5: Commit**

```bash
git add src/heartbeat/empty-check.ts test/unit/heartbeat-empty-check.test.ts
git commit -m "feat(heartbeat): add empty-check + exponential backoff module"
```

---

### Task 4: Create `coalesce.ts` module

**Files:**
- Create: `src/heartbeat/coalesce.ts`
- Create: `test/unit/heartbeat-coalesce.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-coalesce.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { HeartbeatCoalescer } from "../../src/heartbeat/coalesce.js";

describe("HeartbeatCoalescer", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("debounces rapid requests", async () => {
    vi.useFakeTimers();
    const runner = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatCoalescer({ coalesceMs: 250, retryMs: 1000, getQueueSize: () => 0 });

    coalescer.requestRun(runner);
    coalescer.requestRun(runner);
    coalescer.requestRun(runner);

    vi.advanceTimersByTime(250);
    await vi.runAllTimersAsync();

    expect(runner).toHaveBeenCalledOnce();
  });

  it("defers when queue is busy", async () => {
    vi.useFakeTimers();
    let queueSize = 1;
    const runner = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatCoalescer({
      coalesceMs: 250,
      retryMs: 1000,
      getQueueSize: () => queueSize,
    });

    coalescer.requestRun(runner);
    vi.advanceTimersByTime(250);
    await vi.runAllTimersAsync();

    // Should not have run because queue busy
    expect(runner).not.toHaveBeenCalled();

    // Clear queue, advance retry
    queueSize = 0;
    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();

    expect(runner).toHaveBeenCalledOnce();
  });

  it("runs immediately when queue is empty", async () => {
    vi.useFakeTimers();
    const runner = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatCoalescer({ coalesceMs: 250, retryMs: 1000, getQueueSize: () => 0 });

    coalescer.requestRun(runner);
    vi.advanceTimersByTime(250);
    await vi.runAllTimersAsync();

    expect(runner).toHaveBeenCalledOnce();
  });

  it("cancels pending debounce on dispose", () => {
    vi.useFakeTimers();
    const runner = vi.fn().mockResolvedValue(undefined);
    const coalescer = new HeartbeatCoalescer({ coalesceMs: 250, retryMs: 1000, getQueueSize: () => 0 });

    coalescer.requestRun(runner);
    coalescer.dispose();
    vi.advanceTimersByTime(500);

    expect(runner).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/heartbeat-coalesce.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/heartbeat/coalesce.ts`:

```typescript
export interface CoalescerDeps {
  readonly coalesceMs: number;
  readonly retryMs: number;
  readonly getQueueSize: () => number;
}

export class HeartbeatCoalescer {
  private readonly coalesceMs: number;
  private readonly retryMs: number;
  private readonly getQueueSize: () => number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: CoalescerDeps) {
    this.coalesceMs = deps.coalesceMs;
    this.retryMs = deps.retryMs;
    this.getQueueSize = deps.getQueueSize;
  }

  requestRun(runner: () => Promise<void>): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.tryRun(runner);
    }, this.coalesceMs);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private tryRun(runner: () => Promise<void>): void {
    if (this.getQueueSize() > 0) {
      // Queue busy — retry after retryMs
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.tryRun(runner);
      }, this.retryMs);
      return;
    }
    runner().catch(() => {});
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/heartbeat-coalesce.test.ts`
Expected: 4 PASS

**Step 5: Commit**

```bash
git add src/heartbeat/coalesce.ts test/unit/heartbeat-coalesce.test.ts
git commit -m "feat(heartbeat): add coalescer with debounce + queue gate"
```

---

### Task 5: Add dedup table + agent_id to store

**Files:**
- Modify: `src/heartbeat/store.ts`
- Create: `test/unit/heartbeat-store-dedup.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-store-dedup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";

describe("HeartbeatStore dedup", () => {
  let dir: string;
  let db: VaultDB;
  let store: HeartbeatStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-hb-dedup-"));
    db = new VaultDB(dir);
    store = new HeartbeatStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("isDuplicate returns false when no previous alert", () => {
    expect(store.isDuplicate("bridge", "default", "Bridge is down", 86_400_000)).toBe(false);
  });

  it("isDuplicate returns true for same alert within window", () => {
    store.recordAlert("bridge", "default", "Bridge is down");
    expect(store.isDuplicate("bridge", "default", "Bridge is down", 86_400_000)).toBe(true);
  });

  it("isDuplicate returns false for different text", () => {
    store.recordAlert("bridge", "default", "Bridge is down");
    expect(store.isDuplicate("bridge", "default", "Bridge is degraded", 86_400_000)).toBe(false);
  });

  it("isDuplicate returns false after window expires", () => {
    store.recordAlert("bridge", "default", "Bridge is down");
    // Manually update last_sent_at to be old
    db.raw().prepare("UPDATE heartbeat_dedup SET last_sent_at = ?").run(Date.now() - 100_000_000);
    expect(store.isDuplicate("bridge", "default", "Bridge is down", 86_400_000)).toBe(false);
  });

  it("logCheck accepts agentId", () => {
    store.logCheck({
      component: "bridge",
      status: "healthy",
      latencyMs: 5,
      agentId: "production",
    });
    const logs = store.getRecentLogs("bridge", 10);
    expect(logs).toHaveLength(1);
  });

  it("logAction accepts agentId", () => {
    store.logAction({
      component: "bridge",
      action: "self-heal",
      success: true,
      agentId: "production",
    });
    const actions = store.getRecentActions("bridge", 10);
    expect(actions).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/heartbeat-store-dedup.test.ts`
Expected: FAIL — `isDuplicate` is not a function

**Step 3: Update store implementation**

Modify `src/heartbeat/store.ts`:

- Add `agent_id` column to existing tables via `ALTER TABLE` (with `try/catch` for re-run safety)
- Add `heartbeat_dedup` table
- Add `agentId?: string` to `LogCheckParams` and `LogActionParams`
- Add `isDuplicate(component, agentId, text, windowMs)` method
- Add `recordAlert(component, agentId, text)` method

The HEARTBEAT_SCHEMA constant (line 4-20) changes to:

```typescript
const HEARTBEAT_SCHEMA = `
CREATE TABLE IF NOT EXISTS heartbeat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL, status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL, details TEXT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_heartbeat_component ON heartbeat_log(component, checked_at);

CREATE TABLE IF NOT EXISTS heartbeat_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL, action TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0, error TEXT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  executed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_component ON heartbeat_actions(component, executed_at);

CREATE TABLE IF NOT EXISTS heartbeat_dedup (
  component TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'default',
  last_alert_text TEXT NOT NULL,
  last_sent_at INTEGER NOT NULL,
  PRIMARY KEY (component, agent_id)
);
`;
```

The `LogCheckParams` (line 22-27) becomes:

```typescript
interface LogCheckParams {
  readonly component: string;
  readonly status: string;
  readonly latencyMs: number;
  readonly details?: string;
  readonly agentId?: string;
}
```

The `LogActionParams` (line 29-34) becomes:

```typescript
interface LogActionParams {
  readonly component: string;
  readonly action: string;
  readonly success: boolean;
  readonly error?: string;
  readonly agentId?: string;
}
```

In `logCheck()` (line 44-57), pass `params.agentId ?? "default"`:

```typescript
  logCheck(params: LogCheckParams): void {
    this.db
      .prepare(
        `INSERT INTO heartbeat_log (component, status, latency_ms, details, agent_id, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.component,
        params.status,
        params.latencyMs,
        params.details ?? null,
        params.agentId ?? "default",
        Date.now(),
      );
  }
```

In `logAction()` (line 59-72), pass `params.agentId ?? "default"`:

```typescript
  logAction(params: LogActionParams): void {
    this.db
      .prepare(
        `INSERT INTO heartbeat_actions (component, action, success, error, agent_id, executed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.component,
        params.action,
        params.success ? 1 : 0,
        params.error ?? null,
        params.agentId ?? "default",
        Date.now(),
      );
  }
```

Add two new methods at end of class (before the `// ── Row mappers ──` comment, line 125):

```typescript
  isDuplicate(component: string, agentId: string, text: string, windowMs: number): boolean {
    const row = this.db
      .prepare(
        `SELECT last_alert_text, last_sent_at FROM heartbeat_dedup
         WHERE component = ? AND agent_id = ?`,
      )
      .get(component, agentId) as { last_alert_text: string; last_sent_at: number } | undefined;
    if (!row) return false;
    if (row.last_alert_text.trim() !== text.trim()) return false;
    return Date.now() - row.last_sent_at < windowMs;
  }

  recordAlert(component: string, agentId: string, text: string): void {
    this.db
      .prepare(
        `INSERT INTO heartbeat_dedup (component, agent_id, last_alert_text, last_sent_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(component, agent_id)
         DO UPDATE SET last_alert_text = excluded.last_alert_text, last_sent_at = excluded.last_sent_at`,
      )
      .run(component, agentId, text.trim(), Date.now());
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/heartbeat-store-dedup.test.ts`
Expected: 6 PASS

**Step 5: Run existing heartbeat tests for no regressions**

Run: `npx vitest run test/unit/heartbeat-engine.test.ts`
Expected: 5 PASS (existing tests use default agentId)

**Step 6: Commit**

```bash
git add src/heartbeat/store.ts test/unit/heartbeat-store-dedup.test.ts
git commit -m "feat(heartbeat): add dedup table + agent_id columns to store"
```

---

### Task 6: Add new config types + Zod schema

**Files:**
- Modify: `src/heartbeat/types.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/config/types.ts`

**Step 1: Extend `HeartbeatConfig` in `src/heartbeat/types.ts`**

Add new interfaces and extend `HeartbeatConfig`. After the existing `HeartbeatActionEntry` (line 32), add:

```typescript
export interface ActiveHoursConfig {
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
}

export interface VisibilityConfig {
  readonly showOk: boolean;
  readonly showAlerts: boolean;
  readonly useIndicator: boolean;
}

export interface EmptyCheckConfig {
  readonly enabled: boolean;
  readonly maxBackoffMs: number;
}

export interface HeartbeatAgentConfig {
  readonly agentId: string;
  readonly intervals?: Partial<HeartbeatConfig["intervals"]>;
  readonly activeHours?: ActiveHoursConfig;
}
```

Extend the existing `HeartbeatConfig` (line 34-51) by adding optional fields after `logRetentionDays`:

```typescript
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
  // V2 features
  readonly activeHours?: ActiveHoursConfig;
  readonly visibility?: VisibilityConfig;
  readonly channelVisibility?: Record<string, Partial<VisibilityConfig>>;
  readonly dedupWindowMs?: number;
  readonly emptyCheck?: EmptyCheckConfig;
  readonly coalesceMs?: number;
  readonly retryMs?: number;
  readonly agents?: HeartbeatAgentConfig[];
}
```

**Step 2: Extend Zod schema in `src/config/schema.ts`**

Replace the `heartbeatSchema` block (line 155-172):

```typescript
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
  // V2
  activeHours: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string().min(1),
  }).optional(),
  visibility: z.object({
    showOk: z.boolean().default(false),
    showAlerts: z.boolean().default(true),
    useIndicator: z.boolean().default(true),
  }).optional(),
  channelVisibility: z.record(z.string(), z.object({
    showOk: z.boolean().optional(),
    showAlerts: z.boolean().optional(),
    useIndicator: z.boolean().optional(),
  })).optional(),
  dedupWindowMs: z.number().positive().default(86_400_000).optional(),
  emptyCheck: z.object({
    enabled: z.boolean().default(true),
    maxBackoffMs: z.number().nonnegative().default(300_000),
  }).optional(),
  coalesceMs: z.number().positive().default(250).optional(),
  retryMs: z.number().positive().default(1_000).optional(),
  agents: z.array(z.object({
    agentId: z.string().min(1),
    intervals: z.object({
      healthy: z.number().positive().optional(),
      degraded: z.number().positive().optional(),
      critical: z.number().positive().optional(),
    }).optional(),
    activeHours: z.object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      timezone: z.string().min(1),
    }).optional(),
  })).optional(),
});
```

**Step 3: Config types re-export is already correct**

`src/config/types.ts` line 193 already re-exports `HeartbeatConfig` from `../heartbeat/types.js`, so the new fields propagate automatically. No changes needed.

**Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: Clean (0 errors)

**Step 5: Commit**

```bash
git add src/heartbeat/types.ts src/config/schema.ts
git commit -m "feat(heartbeat): add v2 config types + Zod schema"
```

---

### Task 7: Add queue size tracking to OpenCode bridge

**Files:**
- Modify: `src/bridge/opencode-client.ts`

**Step 1: Add in-flight counter**

In `src/bridge/opencode-client.ts`, add a private field after line 23 (`private readonly projectDir: string`):

```typescript
  private inFlightCount = 0;
```

**Step 2: Wrap `sendAndWait` with counter**

In `sendAndWait()` (line 106-144), add increment at the top and decrement in finally:

```typescript
  async sendAndWait(
    sessionId: string,
    text: string,
    timeoutMs = 120_000,
    pollMs = 2_000,
  ): Promise<string> {
    this.inFlightCount++;
    try {
      const before = await this.listMessages(sessionId);
      // ... existing implementation unchanged ...
    } finally {
      this.inFlightCount--;
    }
  }
```

**Step 3: Add `getQueueSize` method**

After `checkHealth()` method (line 172-180), add:

```typescript
  getQueueSize(): number {
    return this.inFlightCount;
  }
```

**Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 5: Commit**

```bash
git add src/bridge/opencode-client.ts
git commit -m "feat(bridge): add in-flight prompt counter + getQueueSize()"
```

---

### Task 8: Refactor HeartbeatEngine for multi-agent + all features

**Files:**
- Modify: `src/heartbeat/engine.ts`
- Create: `test/unit/heartbeat-engine-v2.test.ts`

**Step 1: Write the failing test**

Create `test/unit/heartbeat-engine-v2.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";
import { HeartbeatEngine } from "../../src/heartbeat/engine.js";
import type { HeartbeatConfig, HealthChecker, HealthStatus } from "../../src/heartbeat/types.js";
import type { Logger } from "../../src/logging/logger.js";

function fakeChecker(name: string, status: HealthStatus = "healthy"): HealthChecker {
  return {
    name,
    check: vi.fn().mockResolvedValue({ component: name, status, latencyMs: 5 }),
    heal: vi.fn().mockResolvedValue(true),
  };
}

function makeConfig(overrides?: Partial<HeartbeatConfig>): HeartbeatConfig {
  return {
    enabled: true,
    intervals: { healthy: 60_000, degraded: 10_000, critical: 2_000 },
    selfHeal: { enabled: true, maxAttempts: 3, backoffTicks: 3 },
    activity: { enabled: false, dormancyThresholdMs: 3_600_000 },
    logRetentionDays: 7,
    ...overrides,
  };
}

const fakeLogger: Logger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child: vi.fn().mockReturnThis(), level: "info",
} as unknown as Logger;

describe("HeartbeatEngine V2", () => {
  let dir: string;
  let db: VaultDB;
  let store: HeartbeatStore;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), "iris-hb-v2-"));
    db = new VaultDB(dir);
    store = new HeartbeatStore(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("getStatus includes agentId in results", async () => {
    const engine = new HeartbeatEngine({
      store, checkers: [fakeChecker("bridge")], logger: fakeLogger, config: makeConfig(),
    });
    await engine.tick();
    const statuses = engine.getStatus();
    expect(statuses[0]).toHaveProperty("agentId", "default");
  });

  it("multi-agent: each agent runs independently", async () => {
    const config = makeConfig({
      agents: [
        { agentId: "production", intervals: { healthy: 30_000 } },
        { agentId: "staging", intervals: { healthy: 120_000 } },
      ],
    });
    const engine = new HeartbeatEngine({
      store, checkers: [fakeChecker("bridge")], logger: fakeLogger, config,
    });
    await engine.tick();
    const statuses = engine.getStatus();
    const agentIds = statuses.map((s) => s.agentId);
    expect(agentIds).toContain("production");
    expect(agentIds).toContain("staging");
  });

  it("active hours: skips tick when outside window", async () => {
    vi.setSystemTime(new Date("2026-06-15T04:00:00Z")); // 07:00 Chisinau
    const checker = fakeChecker("bridge");
    const config = makeConfig({
      activeHours: { start: "09:00", end: "22:00", timezone: "Europe/Chisinau" },
    });
    const engine = new HeartbeatEngine({
      store, checkers: [checker], logger: fakeLogger, config,
    });
    await engine.tick();
    expect(checker.check).not.toHaveBeenCalled();
  });

  it("coalescing: respects getQueueSize gate", async () => {
    vi.useFakeTimers();
    const checker = fakeChecker("bridge");
    const config = makeConfig({ coalesceMs: 250, retryMs: 1000 });
    let queueSize = 1;
    const engine = new HeartbeatEngine({
      store, checkers: [checker], logger: fakeLogger, config,
      getQueueSize: () => queueSize,
    });

    engine.start();
    vi.advanceTimersByTime(60_000); // trigger tick
    vi.advanceTimersByTime(250);    // coalesce debounce
    await vi.runAllTimersAsync();
    expect(checker.check).not.toHaveBeenCalled(); // blocked by queue

    queueSize = 0;
    vi.advanceTimersByTime(1000); // retry
    await vi.runAllTimersAsync();
    expect(checker.check).toHaveBeenCalled();
    engine.stop();
  });

  it("backward compat: works with no v2 config", async () => {
    const engine = new HeartbeatEngine({
      store, checkers: [fakeChecker("bridge")], logger: fakeLogger, config: makeConfig(),
    });
    engine.start();
    await engine.tick();
    const statuses = engine.getStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].agentId).toBe("default");
    engine.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/heartbeat-engine-v2.test.ts`
Expected: FAIL — `agentId` not in status, etc.

**Step 3: Rewrite engine**

Replace `src/heartbeat/engine.ts` entirely:

```typescript
import type { HeartbeatStore } from "./store.js";
import type {
  HeartbeatConfig,
  HealthChecker,
  HealthResult,
  HealthStatus,
  HeartbeatAgentConfig,
} from "./types.js";
import type { Logger } from "../logging/logger.js";
import { isWithinActiveHours } from "./active-hours.js";
import { shouldSkipEmptyCheck, hashStatuses, computeBackoffInterval, type EmptyCheckState } from "./empty-check.js";
import { HeartbeatCoalescer } from "./coalesce.js";

export interface HeartbeatEngineDeps {
  store: HeartbeatStore;
  checkers: HealthChecker[];
  logger: Logger;
  config: HeartbeatConfig;
  getQueueSize?: () => number;
  userTimezone?: string;
}

interface ComponentState {
  component: string;
  status: HealthStatus;
  healAttempts: number;
  healthyTicks: number;
}

interface AgentState {
  agentId: string;
  components: Map<string, ComponentState>;
  emptyCheck: EmptyCheckState;
  lastRunMs: number;
  nextDueMs: number;
  intervals: HeartbeatConfig["intervals"];
  activeHours?: HeartbeatConfig["activeHours"];
}

export class HeartbeatEngine {
  private readonly store: HeartbeatStore;
  private readonly checkers: HealthChecker[];
  private readonly logger: Logger;
  private readonly config: HeartbeatConfig;
  private readonly getQueueSize: () => number;

  private readonly agents = new Map<string, AgentState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private coalescer: HeartbeatCoalescer | null = null;

  constructor(deps: HeartbeatEngineDeps) {
    this.store = deps.store;
    this.checkers = deps.checkers;
    this.logger = deps.logger;
    this.config = deps.config;
    this.getQueueSize = deps.getQueueSize ?? (() => 0);

    // Initialize agents
    const agentConfigs = this.config.agents;
    if (agentConfigs && agentConfigs.length > 0) {
      for (const ac of agentConfigs) {
        this.agents.set(ac.agentId, this.createAgentState(ac));
      }
    } else {
      // Default single agent
      this.agents.set("default", this.createAgentState({ agentId: "default" }));
    }

    // Initialize coalescer if configured
    if (this.config.coalesceMs && this.config.coalesceMs > 0) {
      this.coalescer = new HeartbeatCoalescer({
        coalesceMs: this.config.coalesceMs,
        retryMs: this.config.retryMs ?? 1_000,
        getQueueSize: this.getQueueSize,
      });
    }
  }

  start(): void {
    const interval = this.shortestInterval();
    this.timer = setInterval(() => {
      this.tickAll().catch((err) => {
        this.logger.error({ err }, "Heartbeat tick error");
      });
    }, interval);
    this.timer.unref();
    this.logger.info({ agents: this.agents.size }, "Heartbeat engine started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.coalescer) this.coalescer.dispose();
    this.logger.info("Heartbeat engine stopped");
  }

  async tick(): Promise<void> {
    return this.tickAll();
  }

  async tickAll(): Promise<void> {
    const now = Date.now();
    for (const [agentId, agent] of this.agents) {
      if (now < agent.nextDueMs) continue;
      await this.tickAgent(agent);
    }
  }

  currentInterval(): number {
    // Backward compat: return the worst-case interval across all agents
    let worst: HealthStatus = "healthy";
    for (const agent of this.agents.values()) {
      for (const state of agent.components.values()) {
        if (state.status === "down") return this.config.intervals.critical;
        if (state.status === "degraded" || state.status === "recovering") worst = "degraded";
      }
    }
    if (worst === "degraded") return this.config.intervals.degraded;
    return this.config.intervals.healthy;
  }

  getStatus(): Array<{ agentId: string; component: string; status: HealthStatus }> {
    const result: Array<{ agentId: string; component: string; status: HealthStatus }> = [];
    for (const [agentId, agent] of this.agents) {
      for (const state of agent.components.values()) {
        result.push({ agentId, component: state.component, status: state.status });
      }
    }
    return result;
  }

  private async tickAgent(agent: AgentState): Promise<void> {
    const agentActiveHours = agent.activeHours ?? this.config.activeHours;
    if (!isWithinActiveHours(agentActiveHours)) {
      this.logger.debug({ agentId: agent.agentId }, "Outside active hours, skipping");
      agent.nextDueMs = Date.now() + this.getAgentInterval(agent);
      return;
    }

    const runChecks = async (): Promise<void> => {
      const results = await Promise.all(this.checkers.map((c) => c.check()));

      // Empty check: hash all statuses, skip if unchanged + all healthy
      const currentStatuses = results.map((r) => ({ component: r.component, status: r.status }));
      const hash = hashStatuses(currentStatuses);
      const allHealthy = results.every((r) => r.status === "healthy");
      const emptyCheckEnabled = this.config.emptyCheck?.enabled ?? false;

      if (allHealthy && shouldSkipEmptyCheck(emptyCheckEnabled, agent.emptyCheck, hash)) {
        this.logger.debug({ agentId: agent.agentId }, "Empty check skip — all healthy, unchanged");
        this.rescheduleAgent(agent, true);
        return;
      }
      if (!allHealthy) {
        // Reset empty-check state on any non-healthy
        agent.emptyCheck.consecutiveEmpty = 0;
        agent.emptyCheck.previousHash = "";
      }

      for (const result of results) {
        this.store.logCheck({
          component: result.component,
          status: result.status,
          latencyMs: result.latencyMs,
          details: result.details,
          agentId: agent.agentId,
        });

        const state = this.getOrCreateState(agent, result.component);
        const previousStatus = state.status;

        if (result.status === "healthy") {
          state.healthyTicks++;
          if (previousStatus === "recovering" && state.healthyTicks >= this.config.selfHeal.backoffTicks) {
            state.status = "healthy";
            state.healAttempts = 0;
          } else if (previousStatus !== "recovering") {
            state.status = "healthy";
          }
        } else {
          state.healthyTicks = 0;
          state.status = result.status;
        }
      }

      // Self-healing pass
      if (this.config.selfHeal.enabled) {
        for (const result of results) {
          const state = agent.components.get(result.component);
          if (!state) continue;

          if (
            (state.status === "down" || state.status === "degraded") &&
            state.healAttempts < this.config.selfHeal.maxAttempts
          ) {
            const checker = this.checkers.find((c) => c.name === result.component);
            if (checker?.heal) {
              const healed = await checker.heal();
              state.healAttempts++;
              this.store.logAction({
                component: result.component,
                action: "self-heal",
                success: healed,
                agentId: agent.agentId,
              });
              if (healed) state.status = "recovering";
            }
          }
        }
      }

      this.rescheduleAgent(agent, allHealthy);
    };

    if (this.coalescer) {
      this.coalescer.requestRun(runChecks);
    } else {
      await runChecks();
    }
  }

  private rescheduleAgent(agent: AgentState, allHealthy: boolean): void {
    let interval = this.getAgentInterval(agent);

    // Apply exponential backoff if all healthy and empty-check enabled
    if (allHealthy && this.config.emptyCheck?.enabled) {
      interval = computeBackoffInterval(
        interval,
        agent.emptyCheck.consecutiveEmpty,
        this.config.emptyCheck.maxBackoffMs ?? 300_000,
      );
    }

    agent.lastRunMs = Date.now();
    agent.nextDueMs = Date.now() + interval;

    // Reschedule global timer to fire at the earliest due agent
    if (this.timer !== null) {
      clearInterval(this.timer);
      const nextInterval = this.shortestInterval();
      this.timer = setInterval(() => {
        this.tickAll().catch((err) => {
          this.logger.error({ err }, "Heartbeat tick error");
        });
      }, nextInterval);
      this.timer.unref();
    }
  }

  private getAgentInterval(agent: AgentState): number {
    // Check for worst status within this agent
    for (const state of agent.components.values()) {
      if (state.status === "down") return agent.intervals.critical;
    }
    for (const state of agent.components.values()) {
      if (state.status === "degraded" || state.status === "recovering") return agent.intervals.degraded;
    }
    return agent.intervals.healthy;
  }

  private shortestInterval(): number {
    let shortest = Infinity;
    for (const agent of this.agents.values()) {
      const interval = this.getAgentInterval(agent);
      if (interval < shortest) shortest = interval;
    }
    return shortest === Infinity ? this.config.intervals.healthy : shortest;
  }

  private createAgentState(ac: Partial<HeartbeatAgentConfig> & { agentId: string }): AgentState {
    return {
      agentId: ac.agentId,
      components: new Map(),
      emptyCheck: { previousHash: "", consecutiveEmpty: 0 },
      lastRunMs: 0,
      nextDueMs: 0, // Run immediately on first tick
      intervals: {
        healthy: ac.intervals?.healthy ?? this.config.intervals.healthy,
        degraded: ac.intervals?.degraded ?? this.config.intervals.degraded,
        critical: ac.intervals?.critical ?? this.config.intervals.critical,
      },
      activeHours: ac.activeHours,
    };
  }

  private getOrCreateState(agent: AgentState, component: string): ComponentState {
    let state = agent.components.get(component);
    if (!state) {
      state = { component, status: "healthy", healAttempts: 0, healthyTicks: 0 };
      agent.components.set(component, state);
    }
    return state;
  }
}
```

**Step 4: Run all heartbeat tests**

Run: `npx vitest run test/unit/heartbeat-engine-v2.test.ts test/unit/heartbeat-engine.test.ts`
Expected: All pass (existing tests still work because default single agent + agentId backward compat)

**Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 6: Commit**

```bash
git add src/heartbeat/engine.ts test/unit/heartbeat-engine-v2.test.ts
git commit -m "feat(heartbeat): refactor engine for multi-agent + all v2 features"
```

---

### Task 9: Wire new deps into lifecycle + tool-server

**Files:**
- Modify: `src/gateway/lifecycle.ts`
- Modify: `src/bridge/tool-server.ts`

**Step 1: Update tool-server heartbeat type**

In `src/bridge/tool-server.ts`, update the `heartbeatEngine` type on line 64 and line 83:

From:
```typescript
heartbeatEngine?: { getStatus(): Array<{ component: string; status: string }> } | null;
```

To:
```typescript
heartbeatEngine?: { getStatus(): Array<{ agentId: string; component: string; status: string }> } | null;
```

Apply same change to line 83 (private field) and line 1252 (`setHeartbeatEngine` parameter).

**Step 2: Update lifecycle to pass getQueueSize**

In `src/gateway/lifecycle.ts`, update the HeartbeatEngine constructor (line 414-419):

From:
```typescript
    heartbeatEngine = new HeartbeatEngine({
      store: heartbeatStore,
      checkers,
      logger,
      config: config.heartbeat,
    });
```

To:
```typescript
    heartbeatEngine = new HeartbeatEngine({
      store: heartbeatStore,
      checkers,
      logger,
      config: config.heartbeat,
      getQueueSize: () => bridge.getQueueSize(),
    });
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/gateway/lifecycle.ts src/bridge/tool-server.ts
git commit -m "feat(heartbeat): wire getQueueSize + multi-agent types to lifecycle"
```

---

### Task 10: Update plugin tool + add heartbeat_trigger

**Files:**
- Modify: `.opencode/plugin/iris.ts`

**Step 1: Update `heartbeat_status` tool description**

In `.opencode/plugin/iris.ts`, find `heartbeat_status` (line 640-647). Update description to mention agentId:

```typescript
    heartbeat_status: tool({
      description:
        "Get Iris system health status — shows each agent's components and their status (healthy/degraded/down). Each entry includes agentId, component name, and status.",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/heartbeat/status"));
      },
    }),
```

**Step 2: Add `heartbeat_trigger` tool**

After `heartbeat_status`, add:

```typescript
    heartbeat_trigger: tool({
      description:
        "Manually trigger a heartbeat check for a specific agent. Useful to force an immediate health check outside normal schedule.",
      args: {
        agentId: tool.schema.string().optional(),
      },
      async execute(args) {
        return JSON.stringify(
          await irisPost("/heartbeat/trigger", {
            agentId: args.agentId ?? "default",
          }),
        );
      },
    }),
```

**Step 3: Add `/heartbeat/trigger` endpoint to tool-server**

In `src/bridge/tool-server.ts`, after the existing `GET /heartbeat/status` endpoint (line 1236), add:

```typescript
    this.app.post("/heartbeat/trigger", async (c) => {
      if (!this.heartbeatEngine) return c.json({ error: "Heartbeat not enabled" }, 503);
      try {
        await (this.heartbeatEngine as any).tick();
        return c.json({ ok: true, components: this.heartbeatEngine.getStatus() });
      } catch (err) {
        return c.json({ error: "Trigger failed" }, 500);
      }
    });
```

**Step 4: Add heartbeat_trigger to irisToolCatalog**

Find the `irisToolCatalog` array in the plugin file and add `"heartbeat_trigger"` after `"heartbeat_status"`.

**Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 6: Commit**

```bash
git add .opencode/plugin/iris.ts src/bridge/tool-server.ts
git commit -m "feat(heartbeat): update plugin tools + add heartbeat_trigger"
```

---

### Task 11: Update AGENTS.md + cookbook

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/cookbook.md`

**Step 1: Update AGENTS.md heartbeat section**

Replace the `### Heartbeat (System Health)` section (lines 58-63 of AGENTS.md) with:

```markdown
### Heartbeat (System Health)
- Use `heartbeat_status` to check the health of all Iris components across all agents
- Use `heartbeat_trigger` to force an immediate health check for a specific agent
- Components monitored: bridge, channels, vault, sessions, memory
- Statuses: healthy, degraded, down, recovering
- Multi-agent support: each agent (e.g., "production", "staging") runs independent health checks
- Active hours gating: checks skip outside configured timezone-aware window
- Alert deduplication: same alert suppressed within configurable window (default 24h)
- Empty-check optimization: skips full check when all healthy + unchanged, with exponential backoff
- Coalescing: rapid heartbeat requests debounced, deferred when AI queue is busy
- Self-healing runs automatically — the system recovers before you notice
```

**Step 2: Update cookbook heartbeat section**

Add a new section or update existing heartbeat section in `docs/cookbook.md` with V2 features documentation.

**Step 3: Commit**

```bash
git add AGENTS.md docs/cookbook.md
git commit -m "docs: heartbeat v2 features in AGENTS.md + cookbook"
```

---

### Task 12: Update existing heartbeat tests

**Files:**
- Modify: `test/unit/heartbeat-engine.test.ts`

**Step 1: Update existing test expectations**

The existing `heartbeat-engine.test.ts` should still pass because the engine defaults to a single "default" agent. However, `getStatus()` now returns `{ agentId, component, status }` instead of `{ component, status }`. Update the test on line 151-158 to account for the new field:

```typescript
  it("getStatus returns current component states", async () => {
    const c1 = fakeChecker("database");
    const c2 = fakeChecker("cache", "degraded");
    const engine = new HeartbeatEngine({
      store,
      checkers: [c1, c2],
      logger: fakeLogger,
      config: makeConfig(),
    });

    await engine.tick();

    const statuses = engine.getStatus();
    expect(statuses).toHaveLength(2);

    const dbStatus = statuses.find((s) => s.component === "database");
    const cacheStatus = statuses.find((s) => s.component === "cache");
    expect(dbStatus?.status).toBe("healthy");
    expect(dbStatus?.agentId).toBe("default");
    expect(cacheStatus?.status).toBe("recovering");
    expect(cacheStatus?.agentId).toBe("default");
  });
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All pass (minus the 6 pre-existing failures in pipeline/message-router)

**Step 3: Commit**

```bash
git add test/unit/heartbeat-engine.test.ts
git commit -m "test: update heartbeat-engine tests for v2 agentId field"
```

---

## Verification Checklist

1. `npx tsc --noEmit` — clean build, 0 errors
2. `npx vitest run test/unit/heartbeat-active-hours.test.ts` — 5 pass
3. `npx vitest run test/unit/heartbeat-visibility.test.ts` — 4 pass
4. `npx vitest run test/unit/heartbeat-empty-check.test.ts` — 8 pass
5. `npx vitest run test/unit/heartbeat-coalesce.test.ts` — 4 pass
6. `npx vitest run test/unit/heartbeat-store-dedup.test.ts` — 6 pass
7. `npx vitest run test/unit/heartbeat-engine.test.ts` — 5 pass (existing, updated)
8. `npx vitest run test/unit/heartbeat-engine-v2.test.ts` — 5 pass (new)
9. `npx vitest run` — no new regressions
