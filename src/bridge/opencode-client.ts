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
import { CircuitBreaker } from "./circuit-breaker.js";
export { CircuitBreaker };
export type { CircuitState } from "./circuit-breaker.js";

export type { OpenCodeEvent, Part, TextPart };

export interface SessionInfo {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
}

export interface SupervisorOptions {
  /** Max restart attempts before giving up. Default: 5 */
  maxRestarts?: number;
  /** Initial backoff ms. Doubles each retry up to maxBackoffMs. Default: 1000 */
  initialBackoffMs?: number;
  /** Maximum backoff ms. Default: 30_000 */
  maxBackoffMs?: number;
  /** Health check interval ms. Default: 5000 */
  healthIntervalMs?: number;
  /** Max queued messages during restart window. Default: 50 */
  maxQueueSize?: number;
  /** Called when max restarts are exceeded (use for owner alerting). */
  onMaxRestartsExceeded?: () => void;
}

export class OpenCodeBridge {
  private client: OpencodeClient | null = null;
  private serverHandle: { url: string; close(): void } | null = null;
  private readonly projectDir: string;
  private inFlightCount = 0;

  // Supervisor state
  private readonly circuitBreaker: CircuitBreaker;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private restartAttempts = 0;
  private isRestarting = false;
  private readonly pendingQueue: Array<() => void> = [];

  private readonly maxRestarts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly healthIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly onMaxRestartsExceeded?: () => void;

  constructor(
    private readonly config: OpenCodeConfig,
    private readonly logger: Logger,
    supervisorOpts: SupervisorOptions = {},
  ) {
    this.projectDir = config.projectDir ?? process.cwd();
    this.maxRestarts = supervisorOpts.maxRestarts ?? 5;
    this.initialBackoffMs = supervisorOpts.initialBackoffMs ?? 1_000;
    this.maxBackoffMs = supervisorOpts.maxBackoffMs ?? 30_000;
    this.healthIntervalMs = supervisorOpts.healthIntervalMs ?? 5_000;
    this.maxQueueSize = supervisorOpts.maxQueueSize ?? 50;
    this.onMaxRestartsExceeded = supervisorOpts.onMaxRestartsExceeded;
    this.circuitBreaker = new CircuitBreaker({ recoveryTimeoutMs: 15_000 });
  }

  async start(): Promise<void> {
    await this._doStart();
    this._startHealthMonitor();
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
  }

  async stop(): Promise<void> {
    this._stopHealthMonitor();
    if (this.serverHandle) {
      this.serverHandle.close();
      this.serverHandle = null;
      this.logger.info("OpenCode server stopped");
    }
    this.client = null;
  }

  private _startHealthMonitor(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      this._healthTick().catch((err) => {
        this.logger.warn({ err }, "Health tick error");
      });
    }, this.healthIntervalMs);
    this.healthTimer.unref?.();
  }

  private _stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async _healthTick(): Promise<void> {
    if (this.isRestarting) return;
    const healthy = await this.checkHealth();
    if (healthy) {
      if (this.circuitBreaker.getState() !== "CLOSED") {
        this.logger.info("OpenCode health restored — closing circuit");
        this.circuitBreaker.onSuccess();
        this.restartAttempts = 0;
        this._drainQueue();
      }
    } else {
      this.logger.warn("OpenCode health check failed — triggering supervisor restart");
      this.circuitBreaker.onFailure();
      this._scheduleRestart(0);
    }
  }

  private _scheduleRestart(attempt: number): void {
    if (this.isRestarting) return;
    if (attempt >= this.maxRestarts) {
      this.logger.error({ maxRestarts: this.maxRestarts }, "Max restarts exceeded — giving up");
      this.onMaxRestartsExceeded?.();
      return;
    }

    this.isRestarting = true;
    const backoff = Math.min(
      this.initialBackoffMs * Math.pow(2, attempt),
      this.maxBackoffMs,
    );
    this.restartAttempts = attempt + 1;
    this.logger.info({ attempt: attempt + 1, backoffMs: backoff }, "Scheduling OpenCode restart");

    setTimeout(async () => {
      try {
        this.logger.info("Restarting OpenCode...");
        if (this.serverHandle) {
          try { this.serverHandle.close(); } catch { /* ignore */ }
          this.serverHandle = null;
        }
        this.client = null;
        await this._doStart();
        const healthy = await this.checkHealth();
        if (healthy) {
          this.logger.info("OpenCode restart succeeded");
          this.circuitBreaker.onSuccess();
          this.restartAttempts = 0;
          this._drainQueue();
        } else {
          this.logger.warn("OpenCode restart did not restore health");
          this._scheduleRestart(attempt + 1);
        }
      } catch (err) {
        this.logger.error({ err }, "OpenCode restart failed");
        this._scheduleRestart(attempt + 1);
      } finally {
        this.isRestarting = false;
      }
    }, backoff);
  }

  private _drainQueue(): void {
    const pending = this.pendingQueue.splice(0);
    this.logger.info({ count: pending.length }, "Draining pending message queue");
    for (const resume of pending) {
      try { resume(); } catch { /* ignore */ }
    }
  }

  /**
   * Returns the circuit breaker for external inspection (e.g., heartbeat checkers).
   */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Returns true if the bridge is currently accepting requests.
   */
  isAvailable(): boolean {
    return this.circuitBreaker.allowRequest();
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
   *
   * If the circuit breaker is OPEN, the message is queued (up to maxQueueSize)
   * and this method awaits recovery before proceeding. Callers should independently
   * handle the OPEN state for user-visible feedback before calling this.
   */
  async sendAndWait(
    sessionId: string,
    text: string,
    timeoutMs = 120_000,
    pollMs = 2_000,
  ): Promise<string> {
    // If circuit is OPEN, queue this request and wait for recovery
    if (!this.circuitBreaker.allowRequest()) {
      if (this.pendingQueue.length >= this.maxQueueSize) {
        this.logger.warn("Pending queue full — dropping message");
        return "";
      }
      this.logger.info("Circuit OPEN — queuing message for later delivery");
      await new Promise<void>((resolve) => {
        this.pendingQueue.push(resolve);
      });
      // Re-check after queue drain; if still not healthy, bail
      if (!this.circuitBreaker.allowRequest()) return "";
    }

    this.inFlightCount++;
    try {
      const result = await this._sendAndWaitInternal(sessionId, text, timeoutMs, pollMs);
      this.circuitBreaker.onSuccess();
      return result;
    } catch (err) {
      this.logger.error({ err }, "sendAndWait failed — circuit breaker notified");
      this.circuitBreaker.onFailure();
      this._scheduleRestart(this.restartAttempts);
      throw err;
    } finally {
      this.inFlightCount--;
    }
  }

  private async _sendAndWaitInternal(
    sessionId: string,
    text: string,
    timeoutMs: number,
    pollMs: number,
  ): Promise<string> {
    const before = await this.listMessages(sessionId);
    const knownCount = before.length;

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

        if (newMsgs.length > 0) {
          const details = newMsgs.map((m) => {
            const parts = m.hasParts ? "\u2713" : "\u25cb";
            const txt = m.text ? ` "${m.text.substring(0, 80)}${m.text.length > 80 ? "\u2026" : ""}"` : "";
            return `  ${m.role}${parts}${txt}`;
          });
          this.logger.info(
            { newMsgs: newMsgs.length },
            `\ud83d\udd04 Poll\n${details.join("\n")}`,
          );
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

  getInFlightCount(): number {
    return this.inFlightCount;
  }

  getPendingQueueSize(): number {
    return this.pendingQueue.length;
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
