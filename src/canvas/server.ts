import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Logger } from "../logging/logger.js";
import { CanvasSession } from "./session.js";
import { renderCanvasHTML } from "./renderer.js";
import type { CanvasComponent } from "./components.js";

export interface CanvasServerConfig {
  readonly port: number;
  readonly hostname: string;
  readonly logger: Logger;
  readonly onMessage?: (sessionId: string, text: string) => void;
}

export class CanvasServer {
  private readonly app: Hono;
  private server: ReturnType<typeof serve> | null = null;
  private readonly sessions = new Map<string, CanvasSession>();
  private readonly config: CanvasServerConfig;
  private wsUpgrade: ReturnType<typeof createNodeWebSocket>["injectWebSocket"] | null = null;

  constructor(config: CanvasServerConfig) {
    this.config = config;
    this.app = new Hono();
    this.setupRoutes();
  }

  getSession(id: string): CanvasSession {
    let session = this.sessions.get(id);
    if (!session) {
      session = new CanvasSession(id);
      this.sessions.set(id, session);
    }
    return session;
  }

  updateComponent(sessionId: string, component: CanvasComponent): void {
    const session = this.getSession(sessionId);
    session.addComponent(component);
  }

  addAssistantMessage(sessionId: string, text: string): void {
    const session = this.getSession(sessionId);
    session.addMessage({ role: "assistant", text, timestamp: Date.now() });
  }

  private setupRoutes(): void {
    const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: this.app });
    this.wsUpgrade = injectWebSocket;

    // Serve canvas HTML
    this.app.get("/", (c) => {
      const sessionId = "default";
      const wsUrl = `ws://${this.config.hostname}:${this.config.port}/ws/${sessionId}`;
      return c.html(renderCanvasHTML(sessionId, wsUrl));
    });

    this.app.get("/canvas/:sessionId", (c) => {
      const sessionId = c.req.param("sessionId");
      const wsUrl = `ws://${this.config.hostname}:${this.config.port}/ws/${sessionId}`;
      return c.html(renderCanvasHTML(sessionId, wsUrl));
    });

    // WebSocket endpoint
    this.app.get(
      "/ws/:sessionId",
      upgradeWebSocket((c) => {
        const sessionId = c.req.param("sessionId");
        const session = this.getSession(sessionId);
        let unsub: (() => void) | null = null;

        return {
          onOpen: (_evt, ws) => {
            unsub = session.addClient((data) => {
              ws.send(data);
            });
          },
          onMessage: (evt, ws) => {
            try {
              const data = JSON.parse(typeof evt.data === "string" ? evt.data : evt.data.toString());
              if (data.type === "message" && data.text) {
                session.addMessage({ role: "user", text: data.text, timestamp: Date.now() });
                this.config.onMessage?.(sessionId, data.text);
              } else if (data.type === "user_action" && data.action) {
                this.config.onMessage?.(sessionId, `[action:${data.action}]`);
              } else if (data.type === "form_submit") {
                this.config.onMessage?.(sessionId, `[form:${data.formId}] ${JSON.stringify(data.data)}`);
              }
            } catch {
              // Ignore malformed messages
            }
          },
          onClose: () => {
            unsub?.();
          },
        };
      }),
    );

    // REST API
    this.app.post("/api/message", async (c) => {
      const body = await c.req.json();
      const sessionId = body.sessionId ?? "default";
      if (body.text) {
        this.addAssistantMessage(sessionId, body.text);
      }
      return c.json({ ok: true });
    });

    this.app.get("/api/sessions", (c) => {
      const sessions = [...this.sessions.entries()].map(([id, s]) => ({
        id,
        clients: s.clientCount,
        components: s.getComponents().length,
        messages: s.getMessages().length,
      }));
      return c.json({ sessions });
    });

    // Canvas update endpoint (for tool-server to call)
    this.app.post("/api/canvas/update", async (c) => {
      const body = await c.req.json();
      const sessionId = body.sessionId ?? "default";
      if (body.component) {
        this.updateComponent(sessionId, body.component);
      }
      if (body.clear) {
        this.getSession(sessionId).clearComponents();
      }
      if (body.remove) {
        this.getSession(sessionId).removeComponent(body.remove);
      }
      return c.json({ ok: true });
    });
  }

  async start(): Promise<void> {
    this.server = serve({
      fetch: this.app.fetch,
      port: this.config.port,
      hostname: this.config.hostname,
    });
    if (this.wsUpgrade) {
      this.wsUpgrade(this.server);
    }
    this.config.logger.info(
      { port: this.config.port },
      "Canvas server started",
    );
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.config.logger.info("Canvas server stopped");
    }
  }
}
