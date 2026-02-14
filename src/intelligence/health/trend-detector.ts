import type { VaultDB } from "../../vault/db.js";
import type { Logger } from "../../logging/logger.js";
import type { TrendResult } from "../types.js";

interface DataPoint {
  readonly value: number;
  readonly timestamp: number;
}

/**
 * Health trend detector.
 * Runs linear regression on heartbeat_log data to detect:
 *  - Degrading components (latency trending up, status trending down)
 *  - Critical trajectory (predicted threshold breach within N hours)
 *
 * Pure math — no AI calls.
 */
export class TrendDetector {
  private readonly db;

  constructor(
    vaultDb: VaultDB,
    private readonly logger: Logger,
  ) {
    this.db = vaultDb.raw();
  }

  /**
   * Analyze trends for all components.
   * Returns trend results for components that have enough data.
   */
  analyzeAll(windowHours = 6, thresholdLatencyMs = 5000): TrendResult[] {
    const components = this.getActiveComponents(windowHours);
    const results: TrendResult[] = [];

    for (const component of components) {
      const result = this.analyzeComponent(component, windowHours, thresholdLatencyMs);
      if (result) results.push(result);
    }

    return results;
  }

  /**
   * Analyze latency trend for a single component.
   */
  analyzeComponent(component: string, windowHours = 6, thresholdMs = 5000): TrendResult | null {
    const cutoff = Date.now() - windowHours * 3_600_000;

    const rows = this.db.prepare(
      `SELECT latency_ms, checked_at FROM heartbeat_log
       WHERE component = ? AND checked_at > ?
       ORDER BY checked_at ASC`,
    ).all(component, cutoff) as Array<{ latency_ms: number; checked_at: number }>;

    if (rows.length < 5) return null; // Need minimum 5 data points

    const points: DataPoint[] = rows.map((r) => ({
      value: r.latency_ms,
      timestamp: r.checked_at,
    }));

    const regression = this.linearRegression(points);
    const trend = this.classifyTrend(regression.slope, points);

    // Predict when threshold will be breached (if degrading)
    let predictedThresholdIn: number | null = null;
    if (regression.slope > 0 && trend !== "stable" && trend !== "improving") {
      const currentValue = regression.intercept + regression.slope * Date.now();
      if (currentValue < thresholdMs) {
        const msUntilThreshold = (thresholdMs - currentValue) / regression.slope;
        predictedThresholdIn = Math.max(0, msUntilThreshold);
      }
    }

    const confidence = Math.min(0.5 + points.length * 0.02, 0.9);

    return {
      component,
      metric: "latency_ms",
      trend,
      slope: regression.slope,
      predictedThresholdIn,
      sampleCount: points.length,
      confidence,
    };
  }

  /**
   * Get error rate trend for a component.
   */
  analyzeErrorRate(component: string, windowHours = 6): TrendResult | null {
    const cutoff = Date.now() - windowHours * 3_600_000;

    // Bucket into 30-minute windows
    const BUCKET_MS = 1_800_000;
    const rows = this.db.prepare(
      `SELECT
        (checked_at / ${BUCKET_MS}) * ${BUCKET_MS} as bucket,
        COUNT(*) as total,
        SUM(CASE WHEN status != 'healthy' THEN 1 ELSE 0 END) as errors
       FROM heartbeat_log
       WHERE component = ? AND checked_at > ?
       GROUP BY bucket
       ORDER BY bucket ASC`,
    ).all(component, cutoff) as Array<{ bucket: number; total: number; errors: number }>;

    if (rows.length < 3) return null;

    const points: DataPoint[] = rows.map((r) => ({
      value: r.total > 0 ? r.errors / r.total : 0,
      timestamp: r.bucket,
    }));

    const regression = this.linearRegression(points);
    const trend = this.classifyTrend(regression.slope * 1000, points); // Scale up for sensitivity

    return {
      component,
      metric: "error_rate",
      trend,
      slope: regression.slope,
      predictedThresholdIn: null,
      sampleCount: rows.length,
      confidence: Math.min(0.4 + rows.length * 0.05, 0.85),
    };
  }

  /**
   * Simple linear regression: y = mx + b
   * Returns slope (m) and intercept (b).
   */
  private linearRegression(points: DataPoint[]): { slope: number; intercept: number; r2: number } {
    const n = points.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

    // Normalize timestamps to avoid floating point issues
    const t0 = points[0].timestamp;
    const xs = points.map((p) => (p.timestamp - t0) / 1000); // seconds from start
    const ys = points.map((p) => p.value);

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += xs[i];
      sumY += ys[i];
      sumXY += xs[i] * ys[i];
      sumX2 += xs[i] * xs[i];
      sumY2 += ys[i] * ys[i];
    }

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // R² (coefficient of determination)
    const meanY = sumY / n;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
      ssTot += (ys[i] - meanY) ** 2;
      ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    // Convert slope back to per-millisecond for callers
    return { slope: slope / 1000, intercept, r2 };
  }

  /**
   * Classify trend based on slope magnitude and direction.
   */
  private classifyTrend(slope: number, points: DataPoint[]): TrendResult["trend"] {
    // Calculate mean value to determine relative significance
    const mean = points.reduce((s, p) => s + p.value, 0) / points.length;
    const relativeSlopePerHour = mean > 0 ? (slope * 3_600_000) / mean : 0;

    // >10% per hour = significant change
    if (relativeSlopePerHour > 0.1) return "degrading";
    if (relativeSlopePerHour > 0.3) return "critical_trajectory";
    if (relativeSlopePerHour < -0.1) return "improving";
    return "stable";
  }

  /**
   * Get list of components that have recent heartbeat data.
   */
  private getActiveComponents(windowHours: number): string[] {
    const cutoff = Date.now() - windowHours * 3_600_000;
    const rows = this.db.prepare(
      "SELECT DISTINCT component FROM heartbeat_log WHERE checked_at > ?",
    ).all(cutoff) as Array<{ component: string }>;
    return rows.map((r) => r.component);
  }
}
