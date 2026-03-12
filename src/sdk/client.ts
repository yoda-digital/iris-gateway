/**
 * Iris Gateway SDK — typed HTTP client for tool-server (port 19877).
 * Use this for out-of-process plugins and external integrations.
 *
 * @example
 * import IrisClient from "./sdk/client.js";
 * const iris = new IrisClient({ baseUrl: "http://localhost:19877" });
 * const { results } = await iris.vault.search({ query: "project goals", limit: 5 });
 */

// ── Options ──────────────────────────────────────────────────────────────────

export interface IrisClientOptions {
  /** Base URL of the tool-server. Default: http://localhost:19877 */
  baseUrl?: string;
  /** Groups all requests into a single execution trace for debugging */
  turnId?: string;
  /** Bearer token (future use — no auth middleware on port 19877 by default) */
  token?: string;
}

// ── Request / Response types ─────────────────────────────────────────────────

export interface VaultSearchParams  { query: string; limit?: number; sessionId?: string }
export interface VaultSearchResult  { results: Array<{ id: string; content: string; score: number; source: string }> }

export interface VaultStoreParams   { sessionId: string; content: string; type?: string; source?: string }
export interface VaultStoreResult   { id: string; ok: boolean }

export interface VaultExtractParams { sessionId: string; context: string[] }
export interface VaultExtractResult { facts: Array<{ content: string; type: string }> }

export interface VaultContextParams { sessionId: string; query?: string }
export interface VaultContextResult { context: string }

export interface SendMessageParams  { channel: string; to: string; text: string; replyToId?: string }
export interface SendMessageResult  { ok: boolean; messageId?: string }

export interface PolicyCheckParams  { tool: string; sessionId?: string; args?: Record<string, unknown> }
export interface PolicyCheckResult  { allowed: boolean; reason?: string; modified?: Record<string, unknown> }

export interface AuditLogParams     { tool: string; sessionId?: string; args?: unknown; result?: unknown; durationMs?: number; turnId?: string }
export interface AuditLogResult     { ok: boolean }

export interface AuditStep          { id: number; timestamp: number; sessionId: string | null; tool: string; args: string | null; result: string | null; durationMs: number | null; turnId: string | null; stepIndex: number | null }
export interface TraceResult        { turnId: string; steps: AuditStep[] }
export interface TracesListResult   { entries: AuditStep[] }
export interface PolicyStatus       { rules: unknown[]; enabled: boolean }
export interface HeartbeatStatus    { status: string; lastRun?: number }

export interface GoalCreateParams   { sessionId: string; channelId: string; senderId: string; content: string; category?: string }
export interface GoalCreateResult   { id: string; ok: boolean }

export interface SystemContextParams   { sessionId: string; senderId: string; channelId: string }
export interface SystemContextResult   { context: string }

export interface ProactiveIntentParams { sessionId: string; senderId: string; channelId: string; chatId: string; what: string; why?: string; category?: string; confidence?: number }
export interface ProactiveIntentResult { id: string; ok: boolean }

// ── Internal transport ────────────────────────────────────────────────────────

type HttpGet    = <T>(path: string)                => Promise<T>;
type HttpPost   = <T>(path: string, body: unknown) => Promise<T>;
type HttpDelete = <T>(path: string)                => Promise<T>;

interface Transport { get: HttpGet; post: HttpPost; delete: HttpDelete }

// ── Namespaced API classes ────────────────────────────────────────────────────

class VaultApi {
  constructor(private readonly t: Transport) {}

  search(p: VaultSearchParams):                   Promise<VaultSearchResult>          { return this.t.post("/vault/search",       p); }
  store(p: VaultStoreParams):                     Promise<VaultStoreResult>           { return this.t.post("/vault/store",        p); }
  extract(p: VaultExtractParams):                 Promise<VaultExtractResult>         { return this.t.post("/vault/extract",      p); }
  context(p: VaultContextParams):                 Promise<VaultContextResult>         { return this.t.post("/vault/context",      p); }
  storeBatch(p: { entries: VaultStoreParams[] }): Promise<{ ok: boolean; count: number }> { return this.t.post("/vault/store-batch", p); }
  deleteMemory(id: string):                       Promise<{ ok: boolean }>            { return this.t.delete(`/vault/memory/${id}`); }
}

class ChannelsApi {
  constructor(private readonly t: Transport) {}

  sendMessage(p: SendMessageParams): Promise<SendMessageResult>    { return this.t.post("/tool/send-message",  p); }
  listChannels():                    Promise<{ channels: string[] }> { return this.t.get("/tool/list-channels"); }
}

class GovernanceApi {
  constructor(private readonly t: Transport) {}

  checkPolicy(p: PolicyCheckParams): Promise<PolicyCheckResult> { return this.t.post("/policy/check-tool", p); }
  logAudit(p: AuditLogParams):       Promise<AuditLogResult>    { return this.t.post("/audit/log",         p); }
  getTrace(turnId: string):          Promise<TraceResult>       { return this.t.get(`/traces/${turnId}`);    }
  listTraces(p?: { session?: string; limit?: number }): Promise<TracesListResult> {
    const qs = new URLSearchParams();
    if (p?.session) qs.set("session", p.session);
    if (p?.limit)   qs.set("limit",   String(p.limit));
    const q = qs.toString();
    return this.t.get(`/traces${q ? "?" + q : ""}`);
  }
  getPolicyStatus():                 Promise<PolicyStatus>      { return this.t.get("/policy/status");        }
}

class IntelligenceApi {
  constructor(private readonly t: Transport) {}

  systemContext(p: SystemContextParams):   Promise<SystemContextResult> { return this.t.post("/session/system-context", p); }
  createGoal(p: GoalCreateParams):         Promise<GoalCreateResult>   { return this.t.post("/goals/create",           p); }
  listGoals(p: { sessionId: string }):     Promise<{ goals: unknown[] }> { return this.t.post("/goals/list",           p); }
}

class SystemApi {
  constructor(private readonly t: Transport) {}

  proactiveIntent(p: ProactiveIntentParams): Promise<ProactiveIntentResult> { return this.t.post("/proactive/intent", p); }
  heartbeatStatus():                         Promise<HeartbeatStatus>       { return this.t.get("/heartbeat/status");    }
}

// ── Main client ───────────────────────────────────────────────────────────────

export class IrisClient {
  readonly vault:        VaultApi;
  readonly channels:     ChannelsApi;
  readonly governance:   GovernanceApi;
  readonly intelligence: IntelligenceApi;
  readonly system:       SystemApi;

  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(opts: IrisClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:19877").replace(/\/$/, "");
    this.headers = {
      "Content-Type": "application/json",
      ...(opts.turnId ? { "x-turn-id": opts.turnId } : {}),
      ...(opts.token  ? { "Authorization": `Bearer ${opts.token}` } : {}),
    };
    const t: Transport = {
      get:    (path)       => this.request("GET",    path),
      post:   (path, body) => this.request("POST",   path, body),
      delete: (path)       => this.request("DELETE", path),
    };
    this.vault        = new VaultApi(t);
    this.channels     = new ChannelsApi(t);
    this.governance   = new GovernanceApi(t);
    this.intelligence = new IntelligenceApi(t);
    this.system       = new SystemApi(t);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Iris SDK: ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }
}

export default IrisClient;
