import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageRouter } from "../../src/bridge/message-router.js";
import { SessionMap } from "../../src/bridge/session-map.js";
import { SecurityGate } from "../../src/security/dm-policy.js";
import { PairingStore } from "../../src/security/pairing-store.js";
import { AllowlistStore } from "../../src/security/allowlist-store.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { MockAdapter } from "../helpers/mock-adapter.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";
import { makeInboundMessage } from "../helpers/fixtures.js";
import pino from "pino";

describe("MessageRouter diff summary", () => {
  let tempDir: string;
  let adapter: MockAdapter;
  let bridge: MockOpenCodeBridge;
  let registry: ChannelRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-test-diff-"));
    writeFileSync(join(tempDir, "pairing.json"), "[]");
    writeFileSync(join(tempDir, "allowlist.json"), "[]");
    bridge = new MockOpenCodeBridge();
    registry = new ChannelRegistry();
    adapter = new MockAdapter();
    registry.register(adapter);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createRouter(reportDiff: boolean): MessageRouter {
    const sessionMap = new SessionMap(tempDir);
    const pairingStore = new PairingStore(tempDir);
    const allowlistStore = new AllowlistStore(tempDir);
    const rateLimiter = new RateLimiter({ perMinute: 30, perHour: 300 });
    const securityGate = new SecurityGate(pairingStore, allowlistStore, rateLimiter, {
      defaultDmPolicy: "open",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 30,
      rateLimitPerHour: 300,
    });
    const logger = pino({ level: "silent" });
    return new MessageRouter(
      bridge as any,
      sessionMap,
      securityGate,
      registry,
      logger,
      {},
      null,
      null,
      null,
      null,
      { reportDiff },
    );
  }

  it("does not append diff when reportDiff is false", async () => {
    bridge.getSessionDiff = vi.fn().mockResolvedValue({
      files: [{ path: "src/a.ts", additions: 10, deletions: 2 }],
    });
    const router = createRouter(false);
    const msg = makeInboundMessage({ channelId: "mock", text: "fix the bug in file handler" });
    await router.handleInbound(msg);

    const sendCalls = adapter.calls.filter((c) => c.method === "sendText");
    const responseTexts = sendCalls.map((c) => (c.args[0] as any).text).join("");
    expect(responseTexts).not.toContain("📝 Changes");
  });

  it("appends diff summary when reportDiff is true and agent is not chat", async () => {
    bridge.getSessionDiff = vi.fn().mockResolvedValue({
      files: [{ path: "src/a.ts", additions: 10, deletions: 2 }],
    });
    bridge.responseText = "Fixed the bug.";
    const router = createRouter(true);
    const msg = makeInboundMessage({ channelId: "mock", text: "fix the bug in file handler" });
    await router.handleInbound(msg);

    const sendCalls = adapter.calls.filter((c) => c.method === "sendText");
    const responseTexts = sendCalls.map((c) => (c.args[0] as any).text).join("");
    expect(responseTexts).toContain("📝 Changes: 1 file");
    expect(responseTexts).toContain("src/a.ts");
  });

  it("does not append diff when agent is chat", async () => {
    bridge.getSessionDiff = vi.fn().mockResolvedValue({
      files: [{ path: "src/a.ts", additions: 10, deletions: 2 }],
    });
    const router = createRouter(true);
    const msg = makeInboundMessage({ channelId: "mock", text: "hello there" });
    await router.handleInbound(msg);

    const sendCalls = adapter.calls.filter((c) => c.method === "sendText");
    const responseTexts = sendCalls.map((c) => (c.args[0] as any).text).join("");
    expect(responseTexts).not.toContain("📝 Changes");
  });

  it("handles diff fetch failure gracefully", async () => {
    bridge.getSessionDiff = vi.fn().mockRejectedValue(new Error("network error"));
    bridge.responseText = "Done.";
    const router = createRouter(true);
    const msg = makeInboundMessage({ channelId: "mock", text: "fix the bug in file handler" });
    await router.handleInbound(msg);

    const sendCalls = adapter.calls.filter((c) => c.method === "sendText");
    const responseTexts = sendCalls.map((c) => (c.args[0] as any).text).join("");
    expect(responseTexts).toContain("Done.");
    expect(responseTexts).not.toContain("📝 Changes");
  });
});
