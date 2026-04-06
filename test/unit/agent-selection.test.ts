import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageRouter } from "../../src/bridge/message-router.js";
import { SessionMap } from "../../src/bridge/session-map.js";
import { SecurityGate } from "../../src/security/dm-policy.js";
import { PairingStore } from "../../src/security/pairing-store.js";
import { AllowlistStore } from "../../src/security/allowlist-store.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";
import pino from "pino";

const tempDirs: string[] = [];

function makeRouter(channelConfigs: Record<string, any> = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "iris-agent-sel-"));
  tempDirs.push(tempDir);

  const bridge = new MockOpenCodeBridge();
  const sessionMap = new SessionMap(tempDir);
  const pairingStore = new PairingStore(tempDir);
  const allowlistStore = new AllowlistStore(tempDir);
  const rateLimiter = new RateLimiter();
  const gate = new SecurityGate(pairingStore, allowlistStore, rateLimiter);
  const registry = new ChannelRegistry();
  const logger = pino({ level: "silent" });

  const router = new MessageRouter(bridge as any, sessionMap, gate, registry, logger, channelConfigs);
  return router;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true }); } catch {}
  }
});

describe("selectAgent() — intent-based routing", () => {
  it("routes 'fix this bug' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("fix this bug in auth.ts", "telegram");
    expect(agent).toBe("build");
  });

  it("routes 'implement a new feature' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("implement a new function in utils.ts", "telegram");
    expect(agent).toBe("build");
  });

  it("routes 'plan the architecture' to plan", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("plan the architecture for the new API", "telegram");
    expect(agent).toBe("plan");
  });

  it("routes 'design the system' to plan", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("design the database schema for users", "telegram");
    expect(agent).toBe("plan");
  });

  it("routes 'explore the codebase' to explore", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("explore the codebase and find all API routes", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes 'where is the function' to explore", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("where is the sendMessage function", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes general chat to chat", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("hello, how are you?", "telegram");
    expect(agent).toBe("chat");
  });

  it("returns defaultAgent from channel config when set", () => {
    const router = makeRouter({ telegram: { defaultAgent: "build" } });
    // Even a casual message should return 'build' when channel overrides
    const agent = (router as any).selectAgent("hello", "telegram");
    expect(agent).toBe("build");
  });

  it("falls back to auto-routing for channels without defaultAgent config", () => {
    const router = makeRouter({ telegram: { defaultAgent: "build" } });
    // Different channel without override
    const agent = (router as any).selectAgent("fix this bug in file.ts", "discord");
    expect(agent).toBe("build"); // from auto-routing
  });

  // Short English commands (relaxed patterns)
  it("routes short command 'fix auth' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("fix auth", "telegram");
    expect(agent).toBe("build");
  });

  it("routes short command 'implement feature' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("implement feature", "telegram");
    expect(agent).toBe("build");
  });

  it("routes short command 'create component' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("create component", "telegram");
    expect(agent).toBe("build");
  });

  // Romanian language support
  it("routes Romanian 'rezolvă eroarea' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("rezolvă eroarea din auth.ts", "telegram");
    expect(agent).toBe("build");
  });

  it("routes Romanian 'implementează funcția' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("implementează funcția nouă", "telegram");
    expect(agent).toBe("build");
  });

  it("routes Romanian without diacritics 'rezolva bug-ul' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("rezolva bug-ul", "telegram");
    expect(agent).toBe("build");
  });

  it("routes Romanian 'unde se află funcția' to explore", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("unde se află funcția sendMessage?", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes Romanian 'explică codul' to explore", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("explică codul din acest fișier", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes Romanian 'planifică arhitectura' to plan", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("planifică arhitectura pentru API", "telegram");
    expect(agent).toBe("plan");
  });

  // Russian language support
  it("routes Russian 'исправь ошибку' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("исправь ошибку в auth.ts", "telegram");
    expect(agent).toBe("build");
  });

  it("routes Russian 'создай функцию' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("создай функцию для обработки", "telegram");
    expect(agent).toBe("build");
  });

  it("routes Russian 'напиши тест' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("напиши тест для этого", "telegram");
    expect(agent).toBe("build");
  });

  it("routes Russian 'где находится функция' to explore", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("где находится функция sendMessage?", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes Russian 'объясни код' to explore", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("объясни как работает этот код", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes Russian 'планируй архитектуру' to plan", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("планируй архитектуру системы", "telegram");
    expect(agent).toBe("plan");
  });

  // Edge cases and fallback to chat
  it("routes casual Romanian greeting to chat", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("salut, ce mai faci?", "telegram");
    expect(agent).toBe("chat");
  });

  it("routes casual Russian greeting to chat", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("привет, как дела?", "telegram");
    expect(agent).toBe("chat");
  });

  it("routes random text without keywords to chat", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("tell me a joke", "telegram");
    expect(agent).toBe("chat");
  });
});
