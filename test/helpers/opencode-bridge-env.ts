import { vi } from "vitest";
import type { OpenCodeConfig } from "../../src/config/types.js";
import type { Logger } from "../../src/logging/logger.js";

export function makeConfig(overrides: Partial<OpenCodeConfig> = {}): OpenCodeConfig {
  return {
    autoSpawn: false,
    hostname: "127.0.0.1",
    port: 4096,
    projectDir: "/tmp/test-project",
    ...overrides,
  };
}

export function makeLogger(): Logger {
  const noop = vi.fn();
  return { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => makeLogger() } as unknown as Logger;
}

export function injectClient(bridge: any, client: Record<string, unknown>): void {
  bridge.client = client;
}

export function makeMockClient(messages: Array<{ role: string; text: string; hasParts: boolean }> = []) {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: {} }),
      messages: vi.fn().mockResolvedValue({
        data: messages.map((m) => ({
          info: { role: m.role },
          parts: m.hasParts
            ? [{ type: "text", text: m.text }]
            : [],
        })),
      }),
      create: vi.fn(),
      prompt: vi.fn(),
      abort: vi.fn(),
      delete: vi.fn(),
    },
    event: { subscribe: vi.fn() },
  };
}
