import { describe, it, expect, vi } from "vitest";

// ─── Telegram adapter ─────────────────────────────────────────────────────────

vi.mock("grammy", () => {
  class Bot {
    api = {
      getMe: vi.fn().mockResolvedValue({ id: 42 }),
      getUpdates: vi.fn().mockResolvedValue([]), // preflight check — no conflict
    };
    on = vi.fn();
    catch = vi.fn();
    start = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves (polling loop)
    stop = vi.fn().mockResolvedValue(undefined);
  }
  return { Bot };
});

describe("TelegramAdapter — isConnected state", () => {
  it("starts as false", async () => {
    const { TelegramAdapter } = await import(
      "../../src/channels/telegram/index.js"
    );
    const adapter = new TelegramAdapter();
    expect(adapter.isConnected).toBe(false);
  });

  it("becomes true after start()", async () => {
    const { TelegramAdapter } = await import(
      "../../src/channels/telegram/index.js"
    );
    const adapter = new TelegramAdapter();
    const ctrl = new AbortController();
    await adapter.start({ token: "test-token" } as any, ctrl.signal);
    expect(adapter.isConnected).toBe(true);
    ctrl.abort();
  });

  it("becomes false after stop()", async () => {
    const { TelegramAdapter } = await import(
      "../../src/channels/telegram/index.js"
    );
    const adapter = new TelegramAdapter();
    const ctrl = new AbortController();
    await adapter.start({ token: "test-token" } as any, ctrl.signal);
    expect(adapter.isConnected).toBe(true);
    await adapter.stop();
    expect(adapter.isConnected).toBe(false);
    ctrl.abort();
  });

  it("emits connected on start and disconnected on stop", async () => {
    const { TelegramAdapter } = await import(
      "../../src/channels/telegram/index.js"
    );
    const adapter = new TelegramAdapter();
    const connected = vi.fn();
    const disconnected = vi.fn();
    adapter.events.on("connected", connected);
    adapter.events.on("disconnected", disconnected);

    const ctrl = new AbortController();
    await adapter.start({ token: "test-token" } as any, ctrl.signal);
    expect(connected).toHaveBeenCalledTimes(1);

    await adapter.stop();
    expect(disconnected).toHaveBeenCalledWith("stopped");
    ctrl.abort();
  });
});

// ─── Discord adapter ──────────────────────────────────────────────────────────

vi.mock("../../src/channels/discord/client.js", () => {
  let readyHandler: (() => void) | null = null;

  const mockClient = {
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "ready") readyHandler = handler;
    }),
    login: vi.fn().mockImplementation(async () => {
      readyHandler?.();
    }),
    destroy: vi.fn(),
  };

  return { createDiscordClient: () => mockClient };
});

describe("DiscordAdapter — isConnected state", () => {
  it("starts as false", async () => {
    const { DiscordAdapter } = await import(
      "../../src/channels/discord/index.js"
    );
    const adapter = new DiscordAdapter();
    expect(adapter.isConnected).toBe(false);
  });

  it("becomes true after start() when ready fires", async () => {
    const { DiscordAdapter } = await import(
      "../../src/channels/discord/index.js"
    );
    const adapter = new DiscordAdapter();
    const ctrl = new AbortController();
    await adapter.start({ token: "test-token" } as any, ctrl.signal);
    expect(adapter.isConnected).toBe(true);
    ctrl.abort();
  });

  it("becomes false after stop()", async () => {
    const { DiscordAdapter } = await import(
      "../../src/channels/discord/index.js"
    );
    const adapter = new DiscordAdapter();
    const ctrl = new AbortController();
    await adapter.start({ token: "test-token" } as any, ctrl.signal);
    expect(adapter.isConnected).toBe(true);
    await adapter.stop();
    expect(adapter.isConnected).toBe(false);
    ctrl.abort();
  });

  it("emits connected on start and disconnected on stop", async () => {
    const { DiscordAdapter } = await import(
      "../../src/channels/discord/index.js"
    );
    const adapter = new DiscordAdapter();
    const connected = vi.fn();
    const disconnected = vi.fn();
    adapter.events.on("connected", connected);
    adapter.events.on("disconnected", disconnected);

    const ctrl = new AbortController();
    await adapter.start({ token: "test-token" } as any, ctrl.signal);
    expect(connected).toHaveBeenCalledTimes(1);

    await adapter.stop();
    expect(disconnected).toHaveBeenCalledWith("stopped");
    ctrl.abort();
  });
});
