import { vi } from "vitest";
import { OpenCodeBridge } from "../../src/bridge/opencode-client.js";
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

/** Inject a fake client into the bridge (bypassing start()). */
export function injectClient(bridge: OpenCodeBridge, client: Record<string, unknown>): void {
  (bridge as any).client = client;
}

/** Build a minimal mock client with session.messages returning the given list. */
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
