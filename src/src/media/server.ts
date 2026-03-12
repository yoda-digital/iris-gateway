import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import type { MediaStore } from "./store.js";
import type { Logger } from "../logging/logger.js";

const DEFAULT_PORT = 19878;

export class MediaServer {
  private readonly app: Hono;
  private server: ReturnType<typeof serve> | null = null;

  constructor(
    private readonly store: MediaStore,
    private readonly logger: Logger,
    private readonly port = DEFAULT_PORT,
    private readonly hostname = "127.0.0.1",
  ) {
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get("/media/:id", async (c) => {
      const id = c.req.param("id");
      const entry = await this.store.getEntry(id);

      if (!entry) {
        return c.json({ error: "Not found" }, 404);
      }

      try {
        const buffer = await readFile(entry.path);
        return new Response(buffer, {
          headers: {
            "Content-Type": entry.mimeType,
            "Content-Length": String(entry.size),
            "Content-Disposition": `inline; filename="${entry.filename}"`,
            "Cache-Control": "private, max-age=1800",
          },
        });
      } catch {
        return c.json({ error: "File not found on disk" }, 404);
      }
    });

    this.app.get("/media/:id/info", async (c) => {
      const id = c.req.param("id");
      const entry = await this.store.getEntry(id);

      if (!entry) {
        return c.json({ error: "Not found" }, 404);
      }

      return c.json({
        id: entry.id,
        mimeType: entry.mimeType,
        filename: entry.filename,
        size: entry.size,
        createdAt: entry.createdAt,
      });
    });
  }

  async start(): Promise<void> {
    this.server = serve({
      fetch: this.app.fetch,
      port: this.port,
      hostname: this.hostname,
    });
    this.logger.info({ port: this.port }, "Media server started");
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /** Get the URL for a media entry */
  getUrl(mediaId: string): string {
    return `http://${this.hostname}:${this.port}/media/${mediaId}`;
  }
}
