import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchTelegramFile } from "../../src/media/fetch.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchTelegramFile", () => {
  it("throws when Telegram getFile API times out (AbortError path)", async () => {
    // Stub fetch to reject immediately with a plain Error (simulates what AbortController produces)
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network timeout")));

    await expect(fetchTelegramFile("test-bot-token", "file123")).rejects.toThrow();
  });

  it("throws when Telegram getFile returns non-ok status", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(null, { status: 403 })),
    );

    await expect(fetchTelegramFile("bad-token", "file123")).rejects.toThrow(
      "Telegram getFile failed: 403",
    );
  });

  it("throws when getFile returns ok:false", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false }), { status: 200 }),
      ),
    );

    await expect(fetchTelegramFile("token", "file123")).rejects.toThrow(
      "Telegram getFile returned no file_path",
    );
  });
});
