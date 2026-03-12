import { describe, it, expect, vi, beforeEach } from "vitest";
import IrisClient from "../../src/sdk/client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockOk(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}
function mockFail(status: number, text = "error") {
  return Promise.resolve({ ok: false, status, text: () => Promise.resolve(text) } as Response);
}

describe("IrisClient SDK", () => {
  let client: IrisClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IrisClient({ baseUrl: "http://localhost:19877", turnId: "test-turn-1" });
  });

  it("sets correct base URL and headers", async () => {
    mockFetch.mockReturnValue(mockOk({ results: [] }));
    await client.vault.search({ query: "test" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:19877/vault/search");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers["x-turn-id"]).toBe("test-turn-1");
  });

  it("vault.search sends correct body", async () => {
    mockFetch.mockReturnValue(mockOk({ results: [] }));
    await client.vault.search({ query: "hello", limit: 3 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ query: "hello", limit: 3 });
  });

  it("vault.store posts to /vault/store", async () => {
    mockFetch.mockReturnValue(mockOk({ id: "abc", ok: true }));
    const r = await client.vault.store({ sessionId: "s1", content: "test fact" });
    expect(r.ok).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toContain("/vault/store");
  });

  it("vault.extract posts to /vault/extract", async () => {
    mockFetch.mockReturnValue(mockOk({ facts: [{ content: "fact1", type: "insight" }] }));
    const r = await client.vault.extract({ sessionId: "s1", context: ["ctx1"] });
    expect(r.facts).toHaveLength(1);
  });

  it("vault.deleteMemory calls DELETE", async () => {
    mockFetch.mockReturnValue(mockOk({ ok: true }));
    await client.vault.deleteMemory("mem-123");
    expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    expect(mockFetch.mock.calls[0][0]).toContain("/vault/memory/mem-123");
  });

  it("channels.sendMessage posts to /tool/send-message", async () => {
    mockFetch.mockReturnValue(mockOk({ ok: true }));
    await client.channels.sendMessage({ channel: "telegram", to: "123", text: "hi" });
    expect(mockFetch.mock.calls[0][0]).toContain("/tool/send-message");
  });

  it("channels.listChannels calls GET", async () => {
    mockFetch.mockReturnValue(mockOk({ channels: ["telegram"] }));
    await client.channels.listChannels();
    expect(mockFetch.mock.calls[0][1].method).toBe("GET");
  });

  it("governance.checkPolicy posts to /policy/check-tool", async () => {
    mockFetch.mockReturnValue(mockOk({ allowed: true }));
    const r = await client.governance.checkPolicy({ tool: "vault.store" });
    expect(r.allowed).toBe(true);
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockReturnValue(mockFail(500, "internal error"));
    await expect(client.vault.search({ query: "x" })).rejects.toThrow("500");
  });

  it("trims trailing slash from baseUrl", async () => {
    const c = new IrisClient({ baseUrl: "http://localhost:19877/" });
    mockFetch.mockReturnValue(mockOk({ results: [] }));
    await c.vault.search({ query: "x" });
    expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:19877/vault/search");
  });

  it("vault.context posts to /vault/context", async () => {
    mockFetch.mockReturnValue(mockOk({ context: "test context" }));
    await client.vault.context({ sessionId: "s1", query: "q" });
    expect(mockFetch.mock.calls[0][0]).toContain("/vault/context");
  });

  it("vault.storeBatch posts to /vault/store-batch", async () => {
    mockFetch.mockReturnValue(mockOk({ ok: true, count: 2 }));
    const r = await client.vault.storeBatch({ entries: [{ sessionId: "s1", content: "fact1" }] });
    expect(r.count).toBe(2);
    expect(mockFetch.mock.calls[0][0]).toContain("/vault/store-batch");
  });

  it("intelligence.systemContext posts to /session/system-context", async () => {
    mockFetch.mockReturnValue(mockOk({ context: "sys ctx" }));
    await client.intelligence.systemContext({ sessionId: "s1", senderId: "u1", channelId: "c1" });
    expect(mockFetch.mock.calls[0][0]).toContain("/session/system-context");
  });

  it("intelligence.createGoal posts to /goals/create", async () => {
    mockFetch.mockReturnValue(mockOk({ id: "goal-1", ok: true }));
    const r = await client.intelligence.createGoal({ sessionId: "s1", channelId: "c1", senderId: "u1", content: "goal" });
    expect(r.id).toBe("goal-1");
  });

  it("intelligence.listGoals posts to /goals/list", async () => {
    mockFetch.mockReturnValue(mockOk({ goals: [] }));
    await client.intelligence.listGoals({ sessionId: "s1" });
    expect(mockFetch.mock.calls[0][0]).toContain("/goals/list");
  });

  it("system.proactiveIntent posts to /proactive/intent", async () => {
    mockFetch.mockReturnValue(mockOk({ id: "intent-1", ok: true }));
    const r = await client.system.proactiveIntent({ sessionId: "s1", senderId: "u1", channelId: "c1", chatId: "chat1", what: "remind" });
    expect(r.id).toBe("intent-1");
  });

  it("system.heartbeatStatus calls GET /heartbeat/status", async () => {
    mockFetch.mockReturnValue(mockOk({ status: "ok" }));
    await client.system.heartbeatStatus();
    expect(mockFetch.mock.calls[0][0]).toContain("/heartbeat/status");
  });

  it("governance.getPolicyStatus calls GET /policy/status", async () => {
    mockFetch.mockReturnValue(mockOk({ rules: [] }));
    await client.governance.getPolicyStatus();
    expect(mockFetch.mock.calls[0][0]).toContain("/policy/status");
  });

  it("governance.logAudit posts to /audit/log", async () => {
    mockFetch.mockReturnValue(mockOk({ ok: true }));
    const r = await client.governance.logAudit({ tool: "vault.store", sessionId: "s1", durationMs: 42 });
    expect(r.ok).toBe(true);
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    expect(mockFetch.mock.calls[0][0]).toContain("/audit/log");
  });
});
