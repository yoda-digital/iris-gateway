import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
  type Event as OpenCodeEvent,
  type Part,
  type TextPart,
} from "@opencode-ai/sdk";
import type { OpenCodeConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";

export type { OpenCodeEvent, Part, TextPart };

export interface SessionInfo {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
}

export class OpenCodeBridge {
  private client: OpencodeClient | null = null;
  private serverHandle: { url: string; close(): void } | null = null;
  private readonly projectDir: string;
  private inFlightCount = 0;

  constructor(
    private readonly config: OpenCodeConfig,
    private readonly logger: Logger,
  ) {
    // Resolve project directory: explicit config, or cwd (where .opencode/ lives)
    this.projectDir = config.projectDir ?? process.cwd();
  }

  async start(): Promise<void> {
    if (this.config.autoSpawn) {
      this.logger.info("Spawning OpenCode server...");
      const { client, server } = await createOpencode({
        port: this.config.port,
        hostname: this.config.hostname,
      });
      this.client = client;
      this.serverHandle = server;
      this.logger.info({ url: server.url }, "OpenCode server started");
    } else {
      this.logger.info("Connecting to existing OpenCode server...");
      this.client = createOpencodeClient({
        baseUrl: `http://${this.config.hostname}:${this.config.port}`,
      });
      this.logger.info("Connected to OpenCode server");
    }
  }

  async stop(): Promise<void> {
    if (this.serverHandle) {
      this.serverHandle.close();
      this.serverHandle = null;
      this.logger.info("OpenCode server stopped");
    }
    this.client = null;
  }

  private getClient(): OpencodeClient {
    if (!this.client) throw new Error("OpenCode bridge not started");
    return this.client;
  }

  async createSession(title?: string): Promise<SessionInfo> {
    const response = await this.getClient().session.create({
      body: { title: title ?? "Iris Chat" },
      query: { directory: this.projectDir },
      throwOnError: true,
    });
    const session = response.data;
    return {
      id: session.id,
      title: session.title ?? title ?? "Iris Chat",
      createdAt: session.time.created,
    };
  }

  async sendMessage(sessionId: string, text: string): Promise<string> {
    const response = await this.getClient().session.prompt({
      path: { id: sessionId },
      body: { agent: "chat", parts: [{ type: "text", text }] },
      throwOnError: true,
    });
    const parts = response.data.parts ?? [];
    // Prefer text parts; fall back to reasoning if model only produced reasoning
    const textParts = parts.filter((p: Part) => p.type === "text") as TextPart[];
    if (textParts.length > 0) {
      return textParts.map((p) => p.text).join("");
    }
    const reasoningParts = parts.filter((p: Part) => p.type === "reasoning") as Array<{ text: string }>;
    return reasoningParts.map((p) => p.text).join("");
  }

  private getBaseUrl(): string {
    if (this.serverHandle) return this.serverHandle.url;
    return `http://${this.config.hostname}:${this.config.port}`;
  }

  /**
   * Send a message and poll for the assistant response.
   * Uses raw fetch to POST /prompt_async (bypasses SDK which may serialize
   * differently from what the server expects).
   */
  async sendAndWait(
    sessionId: string,
    text: string,
    timeoutMs = 120_000,
    pollMs = 2_000,
  ): Promise<string> {
    this.inFlightCount++;
    try {
      const before = await this.listMessages(sessionId);
      const knownCount = before.length;

      // Raw fetch — curl works but SDK doesn't, so bypass the SDK
      const url = `${this.getBaseUrl()}/session/${sessionId}/prompt_async`;
      const body = JSON.stringify({
        agent: "chat",
        parts: [{ type: "text", text }],
      });
      this.logger.info({ url, body: body.substring(0, 200) }, "prompt_async via fetch");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      this.logger.info({ status: res.status }, "prompt_async response");

      const deadline = Date.now() + timeoutMs;
      let lastNewCount = 0;
      let stablePolls = 0;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollMs));
        try {
          const msgs = await this.listMessages(sessionId);
          const newMsgs = msgs.slice(knownCount);

          // Primary: look for assistant message with text (includes reasoning fallback)
          for (const msg of newMsgs) {
            if (msg.role === "assistant" && msg.text) {
              return msg.text;
            }
          }

          // Secondary: detect model completion without text response.
          // If we see new messages (tool calls, tool results) but message count
          // stabilizes (no new messages for 3 consecutive polls), the model is done.
          // This handles models that respond purely through tool calls (send_message).
          if (newMsgs.length > 0) {
            if (newMsgs.length === lastNewCount) {
              stablePolls++;
            } else {
              stablePolls = 0;
              lastNewCount = newMsgs.length;
            }
            // 3 stable polls = 6s of no new messages after model activity
            if (stablePolls >= 3) {
              this.logger.info(
                { sessionId, newMessages: newMsgs.length },
                "Model completed with tool calls only (no text response)",
              );
              return "";
            }
          }
        } catch {
          // Retry on transient errors
        }
      }
      return "";
    } finally {
      this.inFlightCount--;
    }
  }

  async subscribeEvents(
    onEvent: (event: OpenCodeEvent) => void,
  ): Promise<void> {
    const result = await this.getClient().event.subscribe({
      onSseEvent: (streamEvent) => {
        if (streamEvent.data && typeof streamEvent.data === "object") {
          onEvent(streamEvent.data as OpenCodeEvent);
        }
      },
    });
    // Consume the stream to keep the connection alive
    const stream = result.stream as AsyncIterable<unknown> | undefined;
    if (stream) {
      for await (const _ of stream) {
        // Events are delivered via onSseEvent callback
      }
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.getClient().session.abort({
      path: { id: sessionId },
      throwOnError: true,
    });
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.getClient().session.list();
      return true;
    } catch (err) {
      this.logger.warn({ err }, "OpenCode health check failed");
      return false;
    }
  }

  getQueueSize(): number {
    return this.inFlightCount;
  }

  async listSessions(): Promise<SessionInfo[]> {
    const response = await this.getClient().session.list({ throwOnError: true });
    return Object.values(response.data).map((s) => ({
      id: s.id,
      title: s.title ?? "",
      createdAt: s.time.created,
    }));
  }

  async listMessages(sessionId: string): Promise<Array<{ role: string; text: string; hasParts: boolean }>> {
    const response = await this.getClient().session.messages({
      path: { id: sessionId },
      throwOnError: true,
    });
    return (response.data ?? []).map((msg) => {
      const role = msg.info.role;
      const parts = msg.parts ?? [];
      const textParts = parts.filter((p: Part) => p.type === "text") as TextPart[];
      let text = textParts.map((p) => p.text).join("");
      // Fallback: if no text parts, try reasoning parts (models with mandatory reasoning like gpt-oss-120b)
      if (!text) {
        const reasoningParts = parts.filter((p: Part) => p.type === "reasoning") as Array<{ text: string }>;
        text = reasoningParts.map((p) => p.text).join("");
      }
      return {
        role,
        text,
        hasParts: parts.length > 0,
      };
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.getClient().session.delete({
      path: { id: sessionId },
      throwOnError: true,
    });
  }
}
