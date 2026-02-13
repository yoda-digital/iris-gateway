import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ChannelRegistry } from "../channels/registry.js";
import type { OpenCodeBridge } from "../bridge/opencode-client.js";

interface ChannelStatus {
  id: string;
  label: string;
  capabilities: {
    media: boolean;
    edit: boolean;
    delete: boolean;
    reaction: boolean;
  };
}

export class HealthServer {
  private readonly app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private readonly startedAt = Date.now();

  constructor(
    private readonly registry: ChannelRegistry,
    private readonly bridge: OpenCodeBridge,
    private readonly port: number,
    private readonly hostname: string,
  ) {
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get("/health", async (c) => {
      const opencodeHealthy = await this.bridge.checkHealth();
      const channels = this.getChannelStatuses();

      const mem = process.memoryUsage();
      return c.json({
        status: opencodeHealthy && channels.length > 0 ? "ok" : "degraded",
        version: "0.1.0",
        uptime: Date.now() - this.startedAt,
        uptimeHuman: formatUptime(Date.now() - this.startedAt),
        channels,
        opencode: { healthy: opencodeHealthy },
        system: {
          memoryMB: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          },
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid,
        },
      });
    });

    this.app.get("/ready", async (c) => {
      const channels = this.registry.list();
      const opencodeHealthy = await this.bridge.checkHealth();

      if (channels.length === 0) {
        return c.json({ ready: false, reason: "no channels connected" }, 503);
      }
      if (!opencodeHealthy) {
        return c.json({ ready: false, reason: "opencode not reachable" }, 503);
      }
      return c.json({ ready: true, channels: channels.length });
    });

    this.app.get("/channels", (c) => {
      return c.json({ channels: this.getChannelStatuses() });
    });

    this.app.get("/metrics", (c) => {
      const mem = process.memoryUsage();
      const channels = this.registry.list();
      const lines = [
        `# HELP iris_uptime_seconds Gateway uptime in seconds`,
        `# TYPE iris_uptime_seconds gauge`,
        `iris_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`,
        `# HELP iris_channels_connected Number of connected channels`,
        `# TYPE iris_channels_connected gauge`,
        `iris_channels_connected ${channels.length}`,
        `# HELP iris_memory_rss_bytes RSS memory in bytes`,
        `# TYPE iris_memory_rss_bytes gauge`,
        `iris_memory_rss_bytes ${mem.rss}`,
        `# HELP iris_memory_heap_used_bytes Heap used in bytes`,
        `# TYPE iris_memory_heap_used_bytes gauge`,
        `iris_memory_heap_used_bytes ${mem.heapUsed}`,
      ];
      c.header("Content-Type", "text/plain; charset=utf-8");
      return c.text(lines.join("\n") + "\n");
    });
  }

  private getChannelStatuses(): ChannelStatus[] {
    return this.registry.list().map((a) => ({
      id: a.id,
      label: a.label,
      capabilities: {
        media: a.capabilities.image || a.capabilities.video,
        edit: a.capabilities.edit,
        delete: a.capabilities.delete,
        reaction: a.capabilities.reaction,
      },
    }));
  }

  async start(): Promise<void> {
    this.server = serve({
      fetch: this.app.fetch,
      port: this.port,
      hostname: this.hostname,
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
