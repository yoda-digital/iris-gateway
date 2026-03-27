import type { IrisConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import { HeartbeatStore } from "../heartbeat/store.js";
import { HeartbeatEngine } from "../heartbeat/engine.js";
import { ActivityTracker } from "../heartbeat/activity.js";
import { BridgeChecker, ChannelChecker, VaultChecker, SessionChecker, MemoryChecker } from "../heartbeat/checkers.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { VaultDB } from "../vault/db.js";
import type { VaultStore } from "../vault/store.js";
import type { SessionMap } from "../bridge/session-map.js";

export interface HeartbeatComponents {
  heartbeatStore: HeartbeatStore | null;
  heartbeatEngine: HeartbeatEngine | null;
  activityTracker: ActivityTracker | null;
}

export function bootstrapHeartbeat(
  config: IrisConfig,
  logger: Logger,
  vaultDb: VaultDB,
  vaultStore: VaultStore
): { heartbeatStore: HeartbeatStore | null; activityTracker: ActivityTracker | null } {
  let heartbeatStore: HeartbeatStore | null = null;
  let activityTracker: ActivityTracker | null = null;

  if (config.heartbeat?.enabled) {
    heartbeatStore = new HeartbeatStore(vaultDb);
    activityTracker = new ActivityTracker(vaultDb, vaultStore);
    logger.info("Heartbeat store initialized");
  }

  return { heartbeatStore, activityTracker };
}

export function startHeartbeatEngine(
  config: IrisConfig,
  logger: Logger,
  heartbeatStore: HeartbeatStore | null,
  bridge: OpenCodeBridge,
  registry: ChannelRegistry,
  vaultDb: VaultDB,
  sessionMap: SessionMap
): HeartbeatEngine | null {
  if (!config.heartbeat?.enabled || !heartbeatStore) {
    return null;
  }

  const engine = new HeartbeatEngine({
    store: heartbeatStore,
    checkers: [
      new BridgeChecker(bridge),
      new ChannelChecker(registry),
      new VaultChecker(vaultDb),
      new SessionChecker(sessionMap),
      new MemoryChecker(),
    ],
    logger,
    config: config.heartbeat,
    getInFlightCount: () => bridge.getInFlightCount(),
  });

  engine.start();
  logger.info("Heartbeat engine started");

  return engine;
}
