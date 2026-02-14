import type { HealthChecker, HealthResult } from "./types.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { VaultDB } from "../vault/db.js";
import type { SessionMap } from "../bridge/session-map.js";

/* ------------------------------------------------------------------ */
/*  BridgeChecker                                                     */
/* ------------------------------------------------------------------ */

export class BridgeChecker implements HealthChecker {
  readonly name = "bridge";

  constructor(private readonly bridge: OpenCodeBridge) {}

  async check(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const ok = await this.bridge.checkHealth();
      return {
        component: this.name,
        status: ok ? "healthy" : "down",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        component: this.name,
        status: "down",
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  ChannelChecker                                                    */
/* ------------------------------------------------------------------ */

export class ChannelChecker implements HealthChecker {
  readonly name = "channels";

  constructor(private readonly registry: ChannelRegistry) {}

  async check(): Promise<HealthResult> {
    const start = Date.now();
    const adapters = this.registry.list();

    if (adapters.length === 0) {
      return {
        component: this.name,
        status: "healthy",
        latencyMs: Date.now() - start,
        details: "no adapters",
      };
    }

    const connected = adapters.filter((a) => (a as any).isConnected).length;
    const total = adapters.length;

    let status: HealthResult["status"];
    if (connected === total) {
      status = "healthy";
    } else if (connected === 0) {
      status = "down";
    } else {
      status = "degraded";
    }

    return {
      component: this.name,
      status,
      latencyMs: Date.now() - start,
      details: `${connected}/${total} connected`,
    };
  }
}

/* ------------------------------------------------------------------ */
/*  VaultChecker                                                      */
/* ------------------------------------------------------------------ */

export class VaultChecker implements HealthChecker {
  readonly name = "vault";

  constructor(private readonly vault: VaultDB) {}

  async check(): Promise<HealthResult> {
    const start = Date.now();

    if (!this.vault.isOpen()) {
      return {
        component: this.name,
        status: "down",
        latencyMs: Date.now() - start,
        details: "database closed",
      };
    }

    try {
      const rows = this.vault.raw().pragma("integrity_check") as Array<{
        integrity_check: string;
      }>;
      const ok = rows.length > 0 && rows[0].integrity_check === "ok";

      return {
        component: this.name,
        status: ok ? "healthy" : "degraded",
        latencyMs: Date.now() - start,
        details: ok ? undefined : `integrity: ${rows[0]?.integrity_check}`,
      };
    } catch (err) {
      return {
        component: this.name,
        status: "degraded",
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  SessionChecker                                                    */
/* ------------------------------------------------------------------ */

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SessionChecker implements HealthChecker {
  readonly name = "sessions";

  constructor(private readonly sessions: SessionMap) {}

  async check(): Promise<HealthResult> {
    const start = Date.now();
    const entries = await this.sessions.list();
    const now = Date.now();
    const stale = entries.filter(
      (e) => now - e.lastActiveAt > STALE_THRESHOLD_MS,
    ).length;

    return {
      component: this.name,
      status: stale > 10 ? "degraded" : "healthy",
      latencyMs: Date.now() - start,
      details: `total=${entries.length} stale=${stale}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/*  MemoryChecker                                                     */
/* ------------------------------------------------------------------ */

const MB = 1024 * 1024;

export class MemoryChecker implements HealthChecker {
  readonly name = "memory";

  async check(): Promise<HealthResult> {
    const start = Date.now();
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / MB);
    const rssMB = Math.round(mem.rss / MB);

    let status: HealthResult["status"];
    if (heapMB > 1024) {
      status = "down";
    } else if (heapMB > 512) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    return {
      component: this.name,
      status,
      latencyMs: Date.now() - start,
      details: `heap=${heapMB}MB rss=${rssMB}MB`,
    };
  }
}
