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
    const r = await client.vault.extract({ sessionID: "s1", context: ["ctx1"] });
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

  it("governance.getTraces calls GET /traces/:turn_id", async () => {
    mockFetch.mockReturnValue(mockOk({ turn_id: "t1", steps: [] }));
    await client.governance.getTraces("t1");
    expect(mockFetch.mock.calls[0][0]).toContain("/traces/t1");
    expect(mockFetch.mock.calls[0][1].method).toBe("GET");
  });

  it("governance.listTraces passes query params", async () => {
    mockFetch.mockReturnValue(mockOk({ turns: [] }));
    await client.governance.listTraces({ session: "s1", limit: 10 });
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain("session=s1");
    expect(url).toContain("limit=10");
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
});
