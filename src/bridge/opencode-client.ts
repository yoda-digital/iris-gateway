import { metrics } from "../gateway/metrics.js";
import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
  type Event as OpenCodeEvent,
  type Part,
  type TextPart,
  type Permission,
} from "@opencode-ai/sdk";
import type { OpenCodeConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { BridgeSupervisor, type SupervisorOptions } from "./supervisor.js";
export { CircuitBreaker };
export type { CircuitState } from "./circuit-breaker.js";

export type { OpenCodeEvent, Part, TextPart, SupervisorOptions, Permission };

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
  private liveToolCatalog: string[] = [];
  private readonly supervisor: BridgeSupervisor;

  constructor(
    private readonly config: OpenCodeConfig,
    private readonly logger: Logger,
    supervisorOpts: SupervisorOptions = {},
  ) {
    this.projectDir = config.projectDir ?? process.cwd();
    this.supervisor = new BridgeSupervisor(
      logger,
      () => this.checkHealth(),
      () => this._doStart(),
      () => {
        if (this.serverHandle) {
          try { this.serverHandle.close(); } catch { /* ignore */ }
          this.serverHandle = null;
        }
        this.client = null;
      },
      supervisorOpts,
    );
  }

  async start(): Promise<void> {
    await this._doStart();
    this.supervisor.startHealthMonitor();
  }

  private async _doStart(): Promise<void> {
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
    await this.refreshToolCatalog();
  }

  async refreshToolCatalog(): Promise<void> {
    try {
      const response = await this.getClient().tool.ids({ throwOnError: true });
      this.liveToolCatalog = response.data ?? [];
      this.logger.info({ count: this.liveToolCatalog.length }, 'Tool catalog refreshed from OpenCode');
    } catch (err) {
      this.logger.warn({ err }, 'Failed to refresh tool catalog — using cached/static fallback');
    }
  }

  getLiveToolCatalog(): string[] {
    return this.liveToolCatalog;
  }

  async stop(): Promise<void> {
    this.supervisor.stopHealthMonitor();
    if (this.serverHandle) {
      this.serverHandle.close();
      this.serverHandle = null;
      this.logger.info("OpenCode server stopped");
    }
    this.client = null;
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.supervisor.circuitBreaker;
  }

  isAvailable(): boolean {
    return this.supervisor.circuitBreaker.allowRequest();
  }

  private getClient(): OpencodeClient {
    if (!this.client) throw new Error("OpenCode bridge not started");
    return this.client;
  }

  private getBaseUrl(): string {
    if (this.serverHandle) return this.serverHandle.url;
    return `http://${this.config.hostname}:${this.config.port}`;
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

  async approvePermission(
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    await this.getClient().postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response },
      throwOnError: true,
    });
    this.logger.info({ sessionId, permissionId, response }, "Permission decision sent");
  }

  async sendMessage(sessionId: string, text: string, agent = "chat"): Promise<string> {
    const response = await this.getClient().session.prompt({
      path: { id: sessionId },
      body: { agent, parts: [{ type: "text", text }] },
      throwOnError: true,
    });
    const parts = response.data.parts ?? [];
    const textParts = parts.filter((p: Part) => p.type === "text") as TextPart[];
    if (textParts.length > 0) {
      return textParts.map((p) => p.text).join("");
    }
    const reasoningParts = parts.filter((p: Part) => p.type === "reasoning") as Array<{ text: string }>;
    return reasoningParts.map((p) => p.text).join("");
  }

  /**
   * Send a message and poll for the assistant response.
   * If the circuit breaker is OPEN, the message is queued (up to maxQueueSize)
   * and this method awaits recovery before proceeding.
   */
  async sendAndWait(
    sessionId: string,
    text: string,
    timeoutMs = 120_000,
    pollMs = 2_000,
    agent = "chat",
  ): Promise<string> {
    const allowed = await this.supervisor.waitForCircuit();
    if (!allowed) return "";

    this.inFlightCount++;
    metrics.queueDepth.set(this.inFlightCount);
    try {
      const result = await this._sendAndWaitInternal(sessionId, text, timeoutMs, pollMs, agent);
      this.supervisor.circuitBreaker.onSuccess();
      return result;
    } catch (err) {
      this.logger.error({ err }, "sendAndWait failed — circuit breaker notified");
      this.supervisor.circuitBreaker.onFailure();
      this.supervisor.scheduleRestart(this.supervisor.restartAttempts);
      throw err;
    } finally {
      this.inFlightCount--;
      metrics.queueDepth.set(this.inFlightCount);
    }
  }

  private async _sendAndWaitInternal(
    sessionId: string,
    text: string,
    timeoutMs: number,
    pollMs: number,
    agent = "chat",
  ): Promise<string> {
    const before = await this.listMessages(sessionId);
    const knownCount = before.length;

    const url = `${this.getBaseUrl()}/session/${sessionId}/prompt_async`;
    const body = JSON.stringify({
      agent,
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

        if (newMsgs.length > 0) {
          const details = newMsgs.map((m) => {
            const parts = m.hasParts ? "\u2713" : "\u25cb";
            const txt = m.text ? ` "${m.text.substring(0, 80)}${m.text.length > 80 ? "\u2026" : ""}"` : "";
            return `  ${m.role}${parts}${txt}`;
          });
          this.logger.info({ newMsgs: newMsgs.length }, `\ud83d\udd04 Poll\n${details.join("\n")}`);
        }

        const lastMsg = newMsgs[newMsgs.length - 1];
        const stillGenerating = lastMsg?.role === "assistant" && !lastMsg.hasParts;

        if (!stillGenerating) {
          for (let i = newMsgs.length - 1; i >= 0; i--) {
            const msg = newMsgs[i];
            if (msg.role === "assistant" && msg.text && msg.text !== "[user interrupted]") {
              this.logger.info({ textLen: msg.text.length }, "\u2705 Got response");
              return msg.text;
            }
          }
        }

        if (newMsgs.length > 0) {
          if (!stillGenerating && lastMsg?.role === "assistant" && lastMsg.hasParts) {
            if (newMsgs.length === lastNewCount) {
              stablePolls++;
            } else {
              stablePolls = 0;
              lastNewCount = newMsgs.length;
            }
            if (stablePolls >= 5) {
              this.logger.info(
                { sessionId, newMessages: newMsgs.length },
                "Model completed with tool calls only (no text response)",
              );
              return "";
            }
          } else if (!stillGenerating) {
            stablePolls = 0;
            lastNewCount = newMsgs.length;
          } else {
            lastNewCount = newMsgs.length;
          }
        }
      } catch {
        // Retry on transient errors
      }
    }
    return "";
  }

  async subscribeEvents(onEvent: (event: OpenCodeEvent) => void, signal?: AbortSignal): Promise<void> {
    const result = await this.getClient().event.subscribe({
      onSseEvent: (streamEvent) => {
        if (streamEvent.data && typeof streamEvent.data === "object") {
          onEvent(streamEvent.data as OpenCodeEvent);
        }
      },
    });
    const stream = result.stream as (AsyncIterable<unknown> & { return?: (value?: unknown) => Promise<IteratorResult<unknown>> }) | undefined;
    if (stream) {
      // Register abort listener to terminate the stream immediately when signal fires,
      // rather than waiting for the next chunk (which may never arrive on a stalled stream).
      let abortListener: (() => void) | undefined;
      const abortPromise = signal
        ? new Promise<void>((resolve) => {
            if (signal.aborted) {
              // Signal already aborted before we set up the listener
              resolve();
              return;
            }
            abortListener = () => resolve();
            signal.addEventListener("abort", abortListener, { once: true });
          })
        : null;

      try {
        if (abortPromise) {
          // Race each chunk against the abort signal
          const chunkIterator = stream[Symbol.asyncIterator]();
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const chunkPromise = chunkIterator.next();
            const raceResult = await Promise.race([
              chunkPromise.then((r) => ({ kind: "chunk" as const, done: r.done })),
              abortPromise.then(() => ({ kind: "abort" as const, done: false })),
            ]);
            if (raceResult.kind === "abort" || raceResult.done) {
              // Prevent unhandled rejection if the discarded chunkPromise later throws
              chunkPromise.catch(() => {});
              // Terminate the underlying stream iterator
              if (typeof chunkIterator.return === "function") {
                await chunkIterator.return(undefined);
              }
              break;
            }
          }
        } else {
          for await (const _ of stream) {
            // Events are delivered via onSseEvent callback
          }
        }
      } finally {
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
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

  getInFlightCount(): number {
    return this.inFlightCount;
  }

  getPendingQueueSize(): number {
    return this.supervisor.pendingQueue.length;
  }

  /** @deprecated Use getInFlightCount() for heartbeat suppression or getPendingQueueSize() for circuit-breaker queue depth */
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

  private stripThinking(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
      .trim();
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
      if (!text) {
        const reasoningParts = parts.filter((p: Part) => p.type === "reasoning") as Array<{ text: string }>;
        text = reasoningParts.map((p) => p.text).join("");
      }
      text = this.stripThinking(text);
      return { role, text, hasParts: parts.length > 0 };
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.getClient().session.delete({
      path: { id: sessionId },
      throwOnError: true,
    });
  }
}
