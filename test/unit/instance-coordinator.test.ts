import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { InstanceCoordinator } from "../../src/instance/coordinator.js";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

describe("InstanceCoordinator", () => {
  let db: Database.Database;
  let coordinator: InstanceCoordinator;

  beforeEach(() => {
    db = makeDb();
    coordinator = new InstanceCoordinator(db);
  });

  afterEach(() => {
    coordinator.stop();
    db.close();
  });

  it("assigns an instance ID", () => {
    expect(typeof coordinator.instanceId).toBe("string");
    expect(coordinator.instanceId.length).toBeGreaterThan(0);
  });

  it("uses IRIS_INSTANCE_ID env var when set", () => {
    const db2 = makeDb();
    vi.stubEnv("IRIS_INSTANCE_ID", "test-node-42");
    const c = new InstanceCoordinator(db2);
    expect(c.instanceId).toBe("test-node-42");
    c.stop();
    db2.close();
    vi.unstubAllEnvs();
  });

  it("becomes leader after start()", () => {
    coordinator.start();
    expect(coordinator.leader).toBe(true);
  });

  it("fires onLeaderChange when leader is acquired", () => {
    const handler = vi.fn();
    coordinator.onLeaderChange(handler);
    coordinator.start();
    expect(handler).toHaveBeenCalledWith(true);
  });

  it("second instance does NOT become leader while first holds lock", () => {
    coordinator.start();
    expect(coordinator.leader).toBe(true);

    const db2 = makeDb();
    // Share the same lock table via a copy of the tables
    // We simulate by using the same in-memory db reference
    const c2 = new InstanceCoordinator(db);
    c2.start();
    // First coordinator holds the lock; second should not be leader
    expect(c2.leader).toBe(false);
    c2.stop();
    db2.close();
  });

  it("stops cleanly and releases lock", () => {
    coordinator.start();
    coordinator.stop();
    expect(coordinator.leader).toBe(false);
  });

  it("activeInstances returns current instance after start", () => {
    coordinator.start();
    const instances = coordinator.activeInstances();
    expect(instances).toContain(coordinator.instanceId);
  });
});
