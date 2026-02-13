import type { InboundMessage } from "../../src/channels/adapter.js";
import type { IrisConfig } from "../../src/config/types.js";
import type { SessionMapEntry } from "../../src/bridge/session-map.js";

export function makeInboundMessage(
  overrides: Partial<InboundMessage> = {},
): InboundMessage {
  return {
    id: "msg-1",
    channelId: "mock",
    senderId: "user-1",
    senderName: "Test User",
    chatId: "chat-1",
    chatType: "dm",
    text: "Hello",
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  };
}

export function makeIrisConfig(
  overrides: Partial<IrisConfig> = {},
): IrisConfig {
  return {
    gateway: { port: 19876, hostname: "127.0.0.1" },
    channels: {},
    security: {
      defaultDmPolicy: "open",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 30,
      rateLimitPerHour: 300,
    },
    opencode: {
      port: 4096,
      hostname: "127.0.0.1",
      autoSpawn: false,
    },
    logging: { level: "info" },
    ...overrides,
  };
}

export function makeSessionEntry(
  overrides: Partial<SessionMapEntry> = {},
): SessionMapEntry {
  return {
    openCodeSessionId: "session-1",
    channelId: "mock",
    senderId: "user-1",
    chatId: "chat-1",
    chatType: "dm",
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}
