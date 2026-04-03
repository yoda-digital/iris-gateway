/**
 * Unit tests for individual channel adapter implementations.
 * Covers: initialization, start/stop lifecycle, event emission, isConnected state.
 * Issue #65
 */
import { describe, it, expect, vi } from "vitest";

// ─── WhatsApp adapter ──────────────────────────────────────────────────────────

let whatsAppConnectionUpdateHandler: ((update: { connection?: string }) => void) | null = null;

vi.mock("../../src/channels/whatsapp/connection.js", () => ({
  createWhatsAppSocket: vi.fn().mockImplementation(async () => {
    const mockSocket = {
      ev: { on: vi.fn() },
      end: vi.fn(),
    };
    return {
      socket: mockSocket,
      onConnectionUpdate: vi.fn((handler: (update: { connection?: string }) => void) => {
        whatsAppConnectionUpdateHandler = handler;
      }),
    };
  }),
}));

describe("WhatsAppAdapter — initialization", () => {
  it("starts with isConnected = false", async () => {
    const { WhatsAppAdapter } = await import("../../src/channels/whatsapp/index.js");
    const adapter = new WhatsAppAdapter();
    expect(adapter.isConnected).toBe(false);
  });

  it("has correct id and label", async () => {
    const { WhatsAppAdapter } = await import("../../src/channels/whatsapp/index.js");
    const adapter = new WhatsAppAdapter();
    expect(adapter.id).toBe("whatsapp");
    expect(adapter.label).toBe("WhatsApp");
  });

  it("declares expected capabilities", async () => {
    const { WhatsAppAdapter } = await import("../../src/channels/whatsapp/index.js");
    const adapter = new WhatsAppAdapter();
    expect(adapter.capabilities.text).toBe(true);
    expect(adapter.capabilities.reaction).toBe(true);
    expect(adapter.capabilities.thread).toBe(false);
  });
});

describe("WhatsAppAdapter — lifecycle", () => {
  it("sets isConnected = true when connection becomes open", async () => {
    const { WhatsAppAdapter } = await import("../../src/channels/whatsapp/index.js");
    const adapter = new WhatsAppAdapter();
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    whatsAppConnectionUpdateHandler?.({ connection: "open" });
    expect(adapter.isConnected).toBe(true);
    ctrl.abort();
  });

  it("sets isConnected = false when connection closes", async () => {
    const { WhatsAppAdapter } = await import("../../src/channels/whatsapp/index.js");
    const adapter = new WhatsAppAdapter();
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    whatsAppConnectionUpdateHandler?.({ connection: "open" });
    whatsAppConnectionUpdateHandler?.({ connection: "close" });
    expect(adapter.isConnected).toBe(false);
    ctrl.abort();
  });

  it("sets isConnected = false after stop()", async () => {
    const { WhatsAppAdapter } = await import("../../src/channels/whatsapp/index.js");
    const adapter = new WhatsAppAdapter();
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    whatsAppConnectionUpdateHandler?.({ connection: "open" });
    await adapter.stop();
    expect(adapter.isConnected).toBe(false);
    ctrl.abort();
  });
});

describe("WhatsAppAdapter — events", () => {
  it("emits connected when connection opens", async () => {
    const { WhatsAppAdapter } = await import("../../src/channels/whatsapp/index.js");
    const adapter = new WhatsAppAdapter();
    const connected = vi.fn();
    adapter.events.on("connected", connected);
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    whatsAppConnectionUpdateHandler?.({ connection: "open" });
    expect(connected).toHaveBeenCalledTimes(1);
    ctrl.abort();
  });

  it("emits disconnected on stop()", async () => {
    const { WhatsAppAdapter } = await import("../../src/channels/whatsapp/index.js");
    const adapter = new WhatsAppAdapter();
    const disconnected = vi.fn();
    adapter.events.on("disconnected", disconnected);
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    await adapter.stop();
    expect(disconnected).toHaveBeenCalledWith("stopped");
    ctrl.abort();
  });

  it("emits disconnected when connection closes externally", async () => {
    const { WhatsAppAdapter } = await import("../../src/channels/whatsapp/index.js");
    const adapter = new WhatsAppAdapter();
    const disconnected = vi.fn();
    adapter.events.on("disconnected", disconnected);
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    whatsAppConnectionUpdateHandler?.({ connection: "close" });
    expect(disconnected).toHaveBeenCalledWith("connection closed");
    ctrl.abort();
  });
});

// ─── WebChat adapter ───────────────────────────────────────────────────────────

describe("WebChatAdapter — initialization", () => {
  it("starts with isConnected = false", async () => {
    const { WebChatAdapter } = await import("../../src/channels/webchat/index.js");
    const adapter = new WebChatAdapter();
    expect(adapter.isConnected).toBe(false);
  });

  it("has correct id and label", async () => {
    const { WebChatAdapter } = await import("../../src/channels/webchat/index.js");
    const adapter = new WebChatAdapter();
    expect(adapter.id).toBe("webchat");
    expect(adapter.label).toBe("Web Chat");
  });

  it("declares text-only capabilities", async () => {
    const { WebChatAdapter } = await import("../../src/channels/webchat/index.js");
    const adapter = new WebChatAdapter();
    expect(adapter.capabilities.text).toBe(true);
    expect(adapter.capabilities.image).toBe(false);
    expect(adapter.capabilities.reaction).toBe(false);
  });
});

describe("WebChatAdapter — lifecycle", () => {
  it("becomes connected after start()", async () => {
    const { WebChatAdapter } = await import("../../src/channels/webchat/index.js");
    const adapter = new WebChatAdapter();
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    expect(adapter.isConnected).toBe(true);
    ctrl.abort();
  });

  it("becomes disconnected after stop()", async () => {
    const { WebChatAdapter } = await import("../../src/channels/webchat/index.js");
    const adapter = new WebChatAdapter();
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    await adapter.stop();
    expect(adapter.isConnected).toBe(false);
    ctrl.abort();
  });
});

describe("WebChatAdapter — events", () => {
  it("emits connected on start()", async () => {
    const { WebChatAdapter } = await import("../../src/channels/webchat/index.js");
    const adapter = new WebChatAdapter();
    const connected = vi.fn();
    adapter.events.on("connected", connected);
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    expect(connected).toHaveBeenCalledTimes(1);
    ctrl.abort();
  });

  it("emits disconnected with 'stopped' on stop()", async () => {
    const { WebChatAdapter } = await import("../../src/channels/webchat/index.js");
    const adapter = new WebChatAdapter();
    const disconnected = vi.fn();
    adapter.events.on("disconnected", disconnected);
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    await adapter.stop();
    expect(disconnected).toHaveBeenCalledWith("stopped");
    ctrl.abort();
  });

  it("sendText returns a messageId without canvasServer", async () => {
    const { WebChatAdapter } = await import("../../src/channels/webchat/index.js");
    const adapter = new WebChatAdapter();
    const ctrl = new AbortController();
    await adapter.start({} as any, ctrl.signal);
    const result = await adapter.sendText({ to: "user1", text: "hello" });
    expect(result.messageId).toMatch(/^webchat-/);
    ctrl.abort();
  });
});

// ─── Slack adapter ─────────────────────────────────────────────────────────────

vi.mock("@slack/bolt", () => {
  class App {
    message = vi.fn();
    error = vi.fn();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
  }
  return { App };
});

describe("SlackAdapter — initialization", () => {
  it("starts with isConnected = false", async () => {
    const { SlackAdapter } = await import("../../src/channels/slack/index.js");
    const adapter = new SlackAdapter();
    expect(adapter.isConnected).toBe(false);
  });

  it("has correct id and label", async () => {
    const { SlackAdapter } = await import("../../src/channels/slack/index.js");
    const adapter = new SlackAdapter();
    expect(adapter.id).toBe("slack");
    expect(adapter.label).toBe("Slack");
  });

  it("declares expected capabilities", async () => {
    const { SlackAdapter } = await import("../../src/channels/slack/index.js");
    const adapter = new SlackAdapter();
    expect(adapter.capabilities.text).toBe(true);
    expect(adapter.capabilities.reaction).toBe(true);
    expect(adapter.capabilities.typing).toBe(false);
  });

  it("throws if appToken or botToken missing", async () => {
    const { SlackAdapter } = await import("../../src/channels/slack/index.js");
    const adapter = new SlackAdapter();
    await expect(
      adapter.start({ botToken: "token" } as any, new AbortController().signal),
    ).rejects.toThrow("Slack appToken and botToken are required");
  });
});

describe("SlackAdapter — lifecycle", () => {
  it("becomes connected after start()", async () => {
    const { SlackAdapter } = await import("../../src/channels/slack/index.js");
    const adapter = new SlackAdapter();
    const ctrl = new AbortController();
    await adapter.start({ appToken: "xapp-1", botToken: "xoxb-1" } as any, ctrl.signal);
    expect(adapter.isConnected).toBe(true);
    ctrl.abort();
  });

  it("becomes disconnected after stop()", async () => {
    const { SlackAdapter } = await import("../../src/channels/slack/index.js");
    const adapter = new SlackAdapter();
    const ctrl = new AbortController();
    await adapter.start({ appToken: "xapp-1", botToken: "xoxb-1" } as any, ctrl.signal);
    await adapter.stop();
    expect(adapter.isConnected).toBe(false);
    ctrl.abort();
  });
});

describe("SlackAdapter — events", () => {
  it("emits connected on start()", async () => {
    const { SlackAdapter } = await import("../../src/channels/slack/index.js");
    const adapter = new SlackAdapter();
    const connected = vi.fn();
    adapter.events.on("connected", connected);
    const ctrl = new AbortController();
    await adapter.start({ appToken: "xapp-1", botToken: "xoxb-1" } as any, ctrl.signal);
    expect(connected).toHaveBeenCalledTimes(1);
    ctrl.abort();
  });

  it("emits disconnected with 'stopped' on stop()", async () => {
    const { SlackAdapter } = await import("../../src/channels/slack/index.js");
    const adapter = new SlackAdapter();
    const disconnected = vi.fn();
    adapter.events.on("disconnected", disconnected);
    const ctrl = new AbortController();
    await adapter.start({ appToken: "xapp-1", botToken: "xoxb-1" } as any, ctrl.signal);
    await adapter.stop();
    expect(disconnected).toHaveBeenCalledWith("stopped");
    ctrl.abort();
  });
});

// ─── ChannelRegistry ──────────────────────────────────────────────────────────

import { ChannelRegistry } from "../../src/channels/registry.js";

describe("ChannelRegistry", () => {
  const makeAdapter = (id: string) => ({ id } as any);

  it("register() throws on duplicate adapter id", () => {
    const registry = new ChannelRegistry();
    registry.register(makeAdapter("telegram"));
    expect(() => registry.register(makeAdapter("telegram"))).toThrow(
      "Channel adapter already registered: telegram",
    );
  });

  it("get() returns undefined for unknown id", () => {
    const registry = new ChannelRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });
});
