/**
 * Unit tests for src/intelligence/health/trend-detector.ts
 * Uses real VaultDB (in-memory temp dir) + HeartbeatStore to insert data.
 * Issue #107 — coverage fix
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";
import { TrendDetector } from "../../src/intelligence/health/trend-detector.js";

function makeLogger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

describe("TrendDetector", () => {
  let dir: string;
  let db: VaultDB;
  let store: HeartbeatStore;
  let detector: TrendDetector;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-trend-"));
    db = new VaultDB(dir);
    store = new HeartbeatStore(db);
    detector = new TrendDetector(db, makeLogger());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // ─── analyzeAll() ───────────────────────────────────────────────────────────

  describe("analyzeAll()", () => {
    it("returns empty array when no heartbeat data exists", () => {
      const results = detector.analyzeAll();
      expect(results).toEqual([]);
    });

    it("returns empty array when data exists but insufficient points per component (<5)", () => {
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        store.logCheck({ component: "api", status: "healthy", latencyMs: 100 + i * 10 });
      }
      const results = detector.analyzeAll();
      expect(results).toEqual([]);
    });

    it("returns trend result for component with 5+ data points", () => {
      for (let i = 0; i < 6; i++) {
        store.logCheck({ component: "api", status: "healthy", latencyMs: 100 + i * 10 });
      }
      const results = detector.analyzeAll();
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].component).toBe("api");
      expect(results[0].metric).toBe("latency_ms");
    });

    it("returns results for multiple components", () => {
      for (let i = 0; i < 6; i++) {
        store.logCheck({ component: "api", status: "healthy", latencyMs: 100 });
        store.logCheck({ component: "database", status: "healthy", latencyMs: 200 });
      }
      const results = detector.analyzeAll();
      const components = results.map((r) => r.component);
      expect(components).toContain("api");
      expect(components).toContain("database");
    });

    it("trend result includes sampleCount and confidence", () => {
      for (let i = 0; i < 8; i++) {
        store.logCheck({ component: "api", status: "healthy", latencyMs: 100 });
      }
      const results = detector.analyzeAll();
      expect(results[0].sampleCount).toBe(8);
      expect(results[0].confidence).toBeGreaterThan(0);
      expect(results[0].confidence).toBeLessThanOrEqual(1);
    });
  });

  // ─── analyzeComponent() ─────────────────────────────────────────────────────

  describe("analyzeComponent()", () => {
    it("returns null when fewer than 5 data points", () => {
      store.logCheck({ component: "api", status: "healthy", latencyMs: 100 });
      store.logCheck({ component: "api", status: "healthy", latencyMs: 110 });
      const result = detector.analyzeComponent("api");
      expect(result).toBeNull();
    });

    it("returns null for unknown component", () => {
      const result = detector.analyzeComponent("nonexistent");
      expect(result).toBeNull();
    });

    it("returns 'stable' trend for flat latency", () => {
      // Insert 6 identical latencies — slope should be ~0 → stable
      for (let i = 0; i < 6; i++) {
        store.logCheck({ component: "api", status: "healthy", latencyMs: 200 });
      }
      const result = detector.analyzeComponent("api");
      expect(result).not.toBeNull();
      expect(result!.trend).toBe("stable");
    });

    it("returns trend result with correct component and metric fields", () => {
      for (let i = 0; i < 6; i++) {
        store.logCheck({ component: "db", status: "healthy", latencyMs: 300 });
      }
      const result = detector.analyzeComponent("db");
      expect(result).not.toBeNull();
      expect(result!.component).toBe("db");
      expect(result!.metric).toBe("latency_ms");
      expect(result!.slope).toBeDefined();
      expect(result!.sampleCount).toBe(6);
    });

    it("returns predictedThresholdIn = null for stable trend", () => {
      for (let i = 0; i < 6; i++) {
        store.logCheck({ component: "api", status: "healthy", latencyMs: 100 });
      }
      const result = detector.analyzeComponent("api");
      expect(result!.predictedThresholdIn).toBeNull();
    });
  });

  // ─── analyzeErrorRate() ─────────────────────────────────────────────────────

  describe("analyzeErrorRate()", () => {
    it("returns null when fewer than 3 bucket data points", () => {
      // Only insert 2 items — likely fall in 1-2 buckets
      store.logCheck({ component: "api", status: "healthy", latencyMs: 100 });
      store.logCheck({ component: "api", status: "unhealthy", latencyMs: 500 });
      const result = detector.analyzeErrorRate("api");
      expect(result).toBeNull();
    });

    it("returns null for unknown component", () => {
      const result = detector.analyzeErrorRate("does-not-exist");
      expect(result).toBeNull();
    });

    it("returns trend result for component with sufficient bucketed data", () => {
      // Insert data spread across 3+ 30-minute buckets by directly inserting into heartbeat_log
      const raw = db.raw();
      const BUCKET_MS = 1_800_000;
      const now = Date.now();
      // Create 4 buckets worth of data
      for (let b = 0; b < 4; b++) {
        const bucketTime = now - (b + 1) * BUCKET_MS * 2; // spread apart
        for (let j = 0; j < 3; j++) {
          raw.prepare(
            `INSERT INTO heartbeat_log (component, status, latency_ms, agent_id, checked_at)
             VALUES (?, ?, ?, ?, ?)`,
          ).run("api", j === 0 ? "unhealthy" : "healthy", 100, "default", bucketTime + j * 1000);
        }
      }

      const result = detector.analyzeErrorRate("api");
      expect(result).not.toBeNull();
      expect(result!.component).toBe("api");
      expect(result!.metric).toBe("error_rate");
    });
  });

  // ─── trend classification (via analyzeComponent indirectly) ─────────────────

  describe("trend classification", () => {
    it("classifies stable trend for near-zero slope", () => {
      for (let i = 0; i < 8; i++) {
        store.logCheck({ component: "api", status: "healthy", latencyMs: 150 });
      }
      const result = detector.analyzeComponent("api");
      expect(result!.trend).toBe("stable");
    });

    it("result has a valid trend string", () => {
      for (let i = 0; i < 6; i++) {
        store.logCheck({ component: "cache", status: "healthy", latencyMs: 50 + i });
      }
      const result = detector.analyzeComponent("cache");
      expect(["stable", "degrading", "critical_trajectory", "improving"]).toContain(result!.trend);
    });
  });

  // ─── getActiveComponents (via analyzeAll coverage) ───────────────────────────

  describe("window parameter", () => {
    it("respects windowHours parameter and ignores old data", () => {
      // Insert old data (well outside any normal window)
      const raw = db.raw();
      const oldTime = Date.now() - 100 * 3_600_000; // 100 hours ago
      for (let i = 0; i < 6; i++) {
        raw.prepare(
          `INSERT INTO heartbeat_log (component, status, latency_ms, agent_id, checked_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run("api", "healthy", 100, "default", oldTime + i * 1000);
      }

      // analyzeAll with 1-hour window should find no data
      const results = detector.analyzeAll(1);
      expect(results).toEqual([]);
    });
  });
});
