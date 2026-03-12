import type { Logger } from "../logging/logger.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { MessageRouter } from "../bridge/message-router.js";
import type { MessageCache } from "../channels/message-cache.js";
import type { CanvasServer } from "../canvas/server.js";
import type { ToolServer } from "../bridge/tool-server.js";
import type { HealthServer } from "./health.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";
import type { VaultDB } from "../vault/db.js";
import type { PulseEngine } from "../proactive/engine.js";
import type { HeartbeatEngine } from "../heartbeat/engine.js";
import type { IntelligenceBus } from "../intelligence/bus.js";
import type { PluginRegistry as IrisPluginRegistry } from "../plugins/registry.js";
import type { InstanceCoordinator } from "../instance/coordinator.js";

export interface ShutdownDeps {
  logger: Logger;
  registry: ChannelRegistry;
  router: MessageRouter;
  messageCache: MessageCache;
  canvasServer: CanvasServer | null;
  toolServer: ToolServer;
  healthServer: HealthServer;
  bridge: OpenCodeBridge;
  vaultDb: VaultDB;
  pulseEngine: PulseEngine | null;
  heartbeatEngine: HeartbeatEngine | null;
  intelligenceBus: IntelligenceBus | null;
  pluginRegistry: IrisPluginRegistry;
  abortController: AbortController;
  coordinator?: InstanceCoordinator;
}

const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Register SIGTERM/SIGINT handlers and perform graceful shutdown.
 * Stops adapters, servers, and closes the vault DB.
 */
export function registerShutdownHandlers(deps: ShutdownDeps): void {
  let shutdownInProgress = false;

  const shutdown = async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    const { logger, registry, router, messageCache, canvasServer, toolServer,
      healthServer, bridge, vaultDb, pulseEngine, heartbeatEngine,
      intelligenceBus, pluginRegistry, abortController } = deps;

    logger.info("Shutting down gracefully...");

    const forceExit = setTimeout(() => {
      logger.warn("Shutdown timeout reached, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    deps.coordinator?.stop();
    abortController.abort();

    if (pulseEngine) pulseEngine.stop();
    if (heartbeatEngine) heartbeatEngine.stop();
    if (intelligenceBus) intelligenceBus.dispose();

    // Stop channel adapters
    for (const adapter of registry.list()) {
      try { await adapter.stop(); } catch (err) {
        logger.error({ err, channel: adapter.id }, "Error stopping channel");
      }
    }

    // Emit shutdown hook and stop plugin services
    await pluginRegistry.hookBus.emit("gateway.shutdown", undefined as never);
    for (const [name, service] of pluginRegistry.services) {
      try { await service.stop(); } catch (err) {
        logger.error({ err, service: name }, "Error stopping plugin service");
      }
    }

    router.dispose();
    messageCache.dispose();

    if (canvasServer) await canvasServer.stop();
    await toolServer.stop();
    await healthServer.stop();
    await bridge.stop();
    vaultDb.close();

    clearTimeout(forceExit);
    logger.info("Shutdown complete");
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
