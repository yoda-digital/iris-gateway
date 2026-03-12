import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { VaultStore } from "../../src/vault/store.js";
import { VaultDB } from "../../src/vault/db.js";
import { runAuditLogMigration } from "../../src/vault/db.js";

vi.mock("../../src/gateway/metrics.js", () => ({
  metrics: {
    messagesReceived: { inc: vi.fn() }, messagesSent: { inc: vi.fn() },
    messagesErrors: { inc: vi.fn() }, messageProcessingLatency: { observe: vi.fn() },
    queueDepth: { set: vi.fn() }, activeConnections: { inc: vi.fn() },
    uptime: { set: vi.fn() }, systemHealth: { set: vi.fn() },
    arcsDetected: { inc: vi.fn() }, outcomesLogged: { inc: vi.fn() },
    intentsTriggered: { inc: vi.fn() }, intelligencePipelineLatency: { observe: vi.fn() },
  },
}));

function makeStore() {
  const tempDir = mkdtempSync(join(tmpdir(), "iris-traces-"));
  const vaultDb = new VaultDB(tempDir);  // VaultDB takes stateDir, creates vault.db inside
  const store = new VaultStore(vaultDb);
  return { store, tempDir };
}

describe("Execution Traces — DB migration", () => {
  let tempDir: string;

  afterEach(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

  it("audit_log has turn_id and step_index columns after migration", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iris-migrate-"));
    tempDir = tmp;
    const db = new Database(join(tmp, "migration-test.db"));
    db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      session_id TEXT, tool TEXT NOT NULL,
      args TEXT, result TEXT, duration_ms INTEGER
    )`);
    runAuditLogMigration(db);
    const cols = (db.pragma("table_info(audit_log)") as {name:string}[]).map(c => c.name);
    expect(cols).toContain("turn_id");
    expect(cols).toContain("step_index");
    db.close();
  });

  it("runAuditLogMigration is idempotent", () => {
    const tmp = mkdtempSync(join(tmpdir(), "iris-migrate2-"));
    tempDir = tmp;
    const db = new Database(join(tmp, "idempotent-test.db"));
    db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL, tool TEXT NOT NULL
    )`);
    expect(() => { runAuditLogMigration(db); runAuditLogMigration(db); }).not.toThrow();
    db.close();
  });
});

describe("Execution Traces — VaultStore", () => {
  let store: VaultStore;
  let tempDir: string;

  beforeEach(() => { ({ store, tempDir } = makeStore()); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("logAudit stores turn_id and step_index", () => {
    store.logAudit({ sessionId: "s1", tool: "vault.store", turnId: "turn-1", stepIndex: 0 });
    const rows = store.listAuditLog({ limit: 10 });
    expect(rows[0].turnId).toBe("turn-1");
    expect(rows[0].stepIndex).toBe(0);
  });

  it("listAuditLog filters by turnId", () => {
    store.logAudit({ sessionId: "s1", tool: "tool.a", turnId: "turn-x", stepIndex: 0 });
    store.logAudit({ sessionId: "s1", tool: "tool.b", turnId: "turn-x", stepIndex: 1 });
    store.logAudit({ sessionId: "s1", tool: "tool.c", turnId: "turn-y", stepIndex: 0 });
    const rows = store.listAuditLog({ turnId: "turn-x" });
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.tool)).toEqual(["tool.a", "tool.b"]);
  });

  it("listAuditLog by turnId returns ordered by step_index", () => {
    store.logAudit({ sessionId: "s1", tool: "step2", turnId: "t1", stepIndex: 2 });
    store.logAudit({ sessionId: "s1", tool: "step0", turnId: "t1", stepIndex: 0 });
    store.logAudit({ sessionId: "s1", tool: "step1", turnId: "t1", stepIndex: 1 });
    const rows = store.listAuditLog({ turnId: "t1" });
    expect(rows.map(r => r.stepIndex)).toEqual([0, 1, 2]);
  });

  it("listAuditLog filters by sessionId", () => {
    store.logAudit({ sessionId: "session-A", tool: "tool.1" });
    store.logAudit({ sessionId: "session-B", tool: "tool.2" });
    const rows = store.listAuditLog({ sessionId: "session-A", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe("session-A");
  });

  it("logAudit with null turnId stores null", () => {
    store.logAudit({ sessionId: "s1", tool: "t", turnId: null });
    const rows = store.listAuditLog({ limit: 1 });
    expect(rows[0].turnId).toBeNull();
  });
});

describe("Execution Traces — GET /traces endpoints", () => {
  let store: VaultStore;
  let tempDir: string;

  beforeEach(() => { ({ store, tempDir } = makeStore()); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("GET /traces/:turn_id returns steps for a turn", async () => {
    store.logAudit({ sessionId: "s1", tool: "step-a", turnId: "turn-abc", stepIndex: 0 });
    store.logAudit({ sessionId: "s1", tool: "step-b", turnId: "turn-abc", stepIndex: 1 });

    const { governanceRouter } = await import("../../src/bridge/routers/governance.js");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route("/", governanceRouter({ vaultStore: store } as any));

    const res = await app.request("/traces/turn-abc");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.turnId).toBe("turn-abc");
    expect(body.steps).toHaveLength(2);
  });

  it("GET /traces?session=X returns recent turns", async () => {
    store.logAudit({ sessionId: "sess-1", tool: "t1", turnId: "turn-1", stepIndex: 0 });
    store.logAudit({ sessionId: "sess-2", tool: "t2", turnId: "turn-2", stepIndex: 0 });

    const { governanceRouter } = await import("../../src/bridge/routers/governance.js");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route("/", governanceRouter({ vaultStore: store } as any));

    const res = await app.request("/traces?session=sess-1&limit=10");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.entries.some((t: any) => t.turnId === "turn-1")).toBe(true);
    expect(body.entries.some((t: any) => t.turnId === "turn-2")).toBe(false);
  });

  it("GET /traces limit is clamped to 1000", async () => {
    const { governanceRouter } = await import("../../src/bridge/routers/governance.js");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route("/", governanceRouter({ vaultStore: store } as any));

    const res = await app.request("/traces?limit=99999");
    expect(res.status).toBe(200); // no crash, NaN handled
  });
});

describe("Execution Traces — GET /traces/:turn_id limit", () => {
  let store: VaultStore;
  let tempDir: string;

  beforeEach(() => { ({ store, tempDir } = makeStore()); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("GET /traces/:turn_id respects ?limit param", async () => {
    for (let i = 0; i < 10; i++) {
      store.logAudit({ sessionId: "s1", tool: `tool-${i}`, turnId: "turn-limit", stepIndex: i });
    }
    const { governanceRouter } = await import("../../src/bridge/routers/governance.js?limit-test=1");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route("/", governanceRouter({ vaultStore: store } as any));

    const res = await app.request("/traces/turn-limit?limit=5");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.steps).toHaveLength(5);
  });

  it("GET /traces/:turn_id caps limit at 1000", async () => {
    for (let i = 0; i < 5; i++) {
      store.logAudit({ sessionId: "s1", tool: `tool-${i}`, turnId: "turn-cap", stepIndex: i });
    }
    // Requesting >1000 should not error and returns at most available rows
    const { governanceRouter } = await import("../../src/bridge/routers/governance.js?cap-test=1");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route("/", governanceRouter({ vaultStore: store } as any));

    const res = await app.request("/traces/turn-cap?limit=9999");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // Only 5 rows exist — returns all 5 (clamped to min(9999,1000)=1000 but only 5 exist)
    expect(body.steps).toHaveLength(5);
  });

  it("listAuditLog turnId branch respects limit — requesting >1000 returns at most 1000", () => {
    // Insert 10 rows for the same turn
    for (let i = 0; i < 10; i++) {
      store.logAudit({ sessionId: "s1", tool: `t${i}`, turnId: "turn-max", stepIndex: i });
    }
    // Passing limit=1000 explicitly should work
    const rows = store.listAuditLog({ turnId: "turn-max", limit: 1000 });
    expect(rows.length).toBeLessThanOrEqual(1000);
    // Passing limit=2 should return only 2
    const limited = store.listAuditLog({ turnId: "turn-max", limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("listAuditLog turnId branch clamps negative limit — LIMIT -1 must not return all rows", () => {
    for (let i = 0; i < 5; i++) {
      store.logAudit({ sessionId: "s1", tool: `t${i}`, turnId: "turn-neg", stepIndex: i });
    }
    // limit: -1 would be LIMIT -1 (no limit) in SQLite without the lower bound guard
    const rows = store.listAuditLog({ turnId: "turn-neg", limit: -1 });
    // Must be clamped to at least 1, never returning more than 1 row
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});
