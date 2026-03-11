/**
 * Iris Gateway SDK — typed HTTP client for tool-server (port 19877)
 * Use this for out-of-process plugins and external integrations.
 *
 * @example
 * import { IrisClient } from "./sdk/client.js";
 * const iris = new IrisClient({ baseUrl: "http://localhost:19877" });
 * const results = await iris.vault.search({ query: "my query", limit: 5 });
 */

export interface IrisClientOptions {
  /** Base URL of the tool-server. Default: http://localhost:19877 */
  baseUrl?: string;
  /** Optional turn ID for execution trace grouping */
  turnId?: string;
  /** Optional auth token (future use) */
  token?: string;
}

export interface VaultSearchParams { query: string; limit?: number; sessionId?: string; }
export interface VaultSearchResult { results: Array<{ id: string; content: string; score: number; source: string }> }

export interface VaultStoreParams { sessionId: string; content: string; type?: string; source?: string; }
export interface VaultStoreResult { id: string; ok: boolean }

export interface VaultExtractParams { sessionID: string; context: string[] }
export interface VaultExtractResult { facts: Array<{ content: string; type: string }> }

export interface VaultContextParams { sessionId: string; query?: string }
export interface VaultContextResult { context: string }

export interface SendMessageParams { channel: string; to: string; text: string; replyToId?: string }
export interface SendMessageResult { ok: boolean; messageId?: string }

export interface PolicyCheckParams { tool: string; sessionId?: string; args?: Record<string, unknown> }
export interface PolicyCheckResult { allowed: boolean; reason?: string; modified?: Record<string, unknown> }

export interface AuditLogParams { tool: string; sessionId?: string; args?: unknown; result?: unknown; durationMs?: number; turnId?: string }
export interface AuditLogResult { ok: boolean }

export interface GoalCreateParams { sessionId: string; channelId: string; senderId: string; content: string; category?: string }
export interface GoalCreateResult { id: string; ok: boolean }

export interface SystemContextParams { sessionId: string; senderId: string; channelId: string }
export interface SystemContextResult { context: string }

export interface ProactiveIntentParams { sessionId: string; senderId: string; channelId: string; chatId: string; what: string; why?: string; category?: string; confidence?: number }
export interface ProactiveIntentResult { id: string; ok: boolean }

class IrisClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  readonly vault: VaultApi;
  readonly channels: ChannelsApi;
  readonly governance: GovernanceApi;
  readonly intelligence: IntelligenceApi;
  readonly system: SystemApi;

  constructor(opts: IrisClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:19877").replace(/\/$/, "");
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...(opts.turnId ? { "x-turn-id": opts.turnId } : {}),
      ...(opts.token ? { "Authorization": `Bearer ${opts.token}` } : {}),
    };
    this.vault = new VaultApi(this);
    this.channels = new ChannelsApi(this);
    this.governance = new GovernanceApi(this);
    this.intelligence = new IntelligenceApi(this);
    this.system = new SystemApi(this);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.defaultHeaders,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Iris SDK: ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  get<T>(path: string): Promise<T> { return this.request<T>("GET", path); }
  post<T>(path: string, body: unknown): Promise<T> { return this.request<T>("POST", path, body); }
  delete<T>(path: string): Promise<T> { return this.request<T>("DELETE", path); }
}

class VaultApi {
  constructor(private c: IrisClient) {}
  search(p: VaultSearchParams): Promise<VaultSearchResult> { return this.c.post("/vault/search", p); }
  store(p: VaultStoreParams): Promise<VaultStoreResult> { return this.c.post("/vault/store", p); }
  extract(p: VaultExtractParams): Promise<VaultExtractResult> { return this.c.post("/vault/extract", p); }
  context(p: VaultContextParams): Promise<VaultContextResult> { return this.c.post("/vault/context", p); }
  storeBatch(p: { entries: VaultStoreParams[] }): Promise<{ ok: boolean; count: number }> { return this.c.post("/vault/store-batch", p); }
  deleteMemory(id: string): Promise<{ ok: boolean }> { return this.c.delete(`/vault/memory/${id}`); }
}

class ChannelsApi {
  constructor(private c: IrisClient) {}
  sendMessage(p: SendMessageParams): Promise<SendMessageResult> { return this.c.post("/tool/send-message", p); }
  listChannels(): Promise<{ channels: string[] }> { return this.c.get("/tool/list-channels"); }
}

class GovernanceApi {
  constructor(private c: IrisClient) {}
  checkPolicy(p: PolicyCheckParams): Promise<PolicyCheckResult> { return this.c.post("/policy/check-tool", p); }
  logAudit(p: AuditLogParams): Promise<AuditLogResult> { return this.c.post("/audit/log", p); }
  getTraces(turnId: string): Promise<{ turn_id: string; steps: unknown[] }> { return this.c.get(`/traces/${turnId}`); }
  listTraces(params?: { session?: string; limit?: number }): Promise<{ turns: unknown[] }> {
    const qs = new URLSearchParams();
    if (params?.session) qs.set("session", params.session);
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return this.c.get(`/traces${q ? "?" + q : ""}`);
  }
  getPolicyStatus(): Promise<unknown> { return this.c.get("/policy/status"); }
}

class IntelligenceApi {
  constructor(private c: IrisClient) {}
  systemContext(p: SystemContextParams): Promise<SystemContextResult> { return this.c.post("/session/system-context", p); }
  createGoal(p: GoalCreateParams): Promise<GoalCreateResult> { return this.c.post("/goals/create", p); }
  listGoals(p: { sessionId: string }): Promise<{ goals: unknown[] }> { return this.c.post("/goals/list", p); }
}

class SystemApi {
  constructor(private c: IrisClient) {}
  proactiveIntent(p: ProactiveIntentParams): Promise<ProactiveIntentResult> { return this.c.post("/proactive/intent", p); }
  heartbeatStatus(): Promise<unknown> { return this.c.get("/heartbeat/status"); }
}

export { IrisClient };
export default IrisClient;
