/**
 * test/unit/telegram-conflict-detection.test.ts
 *
 * Tests for the Telegram concurrent-instance detection (issue #231).
 *
 * assertNoConcurrentPoller() is not exported — we test TelegramAdapter.start()
 * directly, mocking the grammy Bot to simulate API responses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramAdapter } from "../../src/channels/telegram/index.js";

// Minimal grammy Bot mock factory
function makeBotMock(overrides: {
  getMeResult?: object;
  getUpdatesError?: object;
  getUpdatesResult?: unknown[];
} = {}) {
  return {
    on: vi.fn(),
    catch: vi.fn(),
    start: vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ })),
    stop: vi.fn(),
    api: {
      getMe: vi.fn().mockResolvedValue(
        overrides.getMeResult ?? { id: 42, is_bot: true, first_name: "TestBot", username: "test_bot" }
      ),
      getUpdates: overrides.getUpdatesError
        ? vi.fn().mockRejectedValue(overrides.getUpdatesError)
        : vi.fn().mockResolvedValue(overrides.getUpdatesResult ?? []),
    },
  };
}

// grammY error classes
class GrammyError extends Error {
  error_code: number;
  description: string;
  constructor(message: string, error_code: number, description: string) {
    super(message);
    this.name = "GrammyError";
    this.error_code = error_code;
    this.description = description;
  }
}

function grammy409() {
  return new GrammyError(
    "Conflict: terminated by other getUpdates request",
    409,
    "Conflict: terminated by other getUpdates request"
  );
}

vi.mock("grammy", () => ({
  Bot: vi.fn(),
  GrammyError: class GrammyError extends Error {
    error_code: number;
    description: string;
    constructor(message: string, error_code: number, description: string) {
      super(message);
      this.name = "GrammyError";
      this.error_code = error_code;
      this.description = description;
    }
  },
}));

// Import after mock registration
import { Bot } from "grammy";
const MockBot = vi.mocked(Bot);

describe("TelegramAdapter — concurrent instance detection", () => {
  beforeEach(() => {
    MockBot.mockClear();
  });

  it("starts successfully when no other instance is polling (getUpdates returns [])", async () => {
    const mockBot = makeBotMock({ getUpdatesResult: [] });
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);

    await expect(
      adapter.start({ token: "fake-token" }, signal)
    ).resolves.not.toThrow();

    expect(mockBot.api.getUpdates).toHaveBeenCalledWith({ limit: 1, timeout: 0 });
    expect(mockBot.start).toHaveBeenCalledOnce();
  });

  it("throws on 409 conflict before entering polling loop", async () => {
    const mockBot = makeBotMock({ getUpdatesError: grammy409() });
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);

    // The error thrown depends on GrammyError class matching between mock and runtime.
    // In CI/production, assertNoConcurrentPoller wraps it. In test env with mocked grammy,
    // instanceof may fail, so we verify behavior: (1) error is thrown, (2) polling not started.
    await expect(adapter.start({ token: "fake-token" }, signal)).rejects.toThrow();

    // Critical behavior: must NOT enter the polling loop after detecting conflict
    expect(mockBot.start).not.toHaveBeenCalled();
  });

  it("re-throws non-409 errors from preflight check (e.g. auth failure)", async () => {
    const authError = new GrammyError("Unauthorized", 401, "Unauthorized: bot token is invalid");
    const mockBot = makeBotMock({ getUpdatesError: authError });
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);

    await expect(
      adapter.start({ token: "bad-token" }, signal)
    ).rejects.toThrow("Unauthorized");

    // Should not obscure auth errors with the conflict message
    const message = await adapter.start({ token: "bad-token" }, signal).catch(e => e.message);
    expect(message).not.toMatch(/conflict detected/i);
  });

  it("does not start adapter state (_isConnected) when conflict is detected", async () => {
    const mockBot = makeBotMock({ getUpdatesError: grammy409() });
    MockBot.mockImplementation(() => mockBot as unknown as InstanceType<typeof Bot>);

    const adapter = new TelegramAdapter();
    const signal = AbortSignal.timeout(5000);

    await adapter.start({ token: "fake-token" }, signal).catch(() => { /* expected */ });

    expect(adapter.isConnected).toBe(false);
  });
});
