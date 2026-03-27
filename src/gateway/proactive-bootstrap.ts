import type { IrisConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import { IntentStore } from "../proactive/store.js";
import { PulseEngine } from "../proactive/engine.js";
import type { VaultDB } from "../vault/db.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";
import type { MessageRouter } from "../bridge/message-router.js";
import type { SessionMap } from "../bridge/session-map.js";
import type { VaultStore } from "../vault/store.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { InstanceCoordinator } from "../instance/coordinator.js";

export interface ProactiveComponents {
  intentStore: IntentStore | null;
  pulseEngine: PulseEngine | null;
}

export function bootstrapProactive(
  config: IrisConfig,
  logger: Logger,
  vaultDb: VaultDB
): { intentStore: IntentStore | null } {
  let intentStore: IntentStore | null = null;

  if (config.proactive?.enabled) {
    intentStore = new IntentStore(vaultDb);
    logger.info("Proactive intent store initialized");
  }

  return { intentStore };
}

export function startPulseEngine(
  config: IrisConfig,
  logger: Logger,
  intentStore: IntentStore | null,
  bridge: OpenCodeBridge,
  router: MessageRouter,
  sessionMap: SessionMap,
  vaultStore: VaultStore,
  registry: ChannelRegistry,
  coordinator: InstanceCoordinator
): PulseEngine | null {
  if (!config.proactive?.enabled || !intentStore) {
    return null;
  }

  const engine = new PulseEngine({
    store: intentStore,
    bridge,
    router,
    sessionMap,
    vaultStore,
    registry,
    logger,
    config: config.proactive,
    coordinator,
  });

  engine.start();
  logger.info("Proactive pulse engine started");

  return engine;
}
