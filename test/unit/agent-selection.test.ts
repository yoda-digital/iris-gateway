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
});

describe("selectAgent() — multilingual routing", () => {
  it("routes Romanian build intent: 'rezolvă eroarea din auth.ts'", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("rezolvă eroarea din auth.ts", "telegram");
    expect(agent).toBe("build");
  });

  it("routes Romanian build intent without diacritics: 'rezolva bug-ul'", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("rezolva bug-ul din fisier", "telegram");
    expect(agent).toBe("build");
  });

  it("routes Romanian plan intent: 'planifică arhitectura API-ului'", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("planifică arhitectura API-ului", "telegram");
    expect(agent).toBe("plan");
  });

  it("routes Romanian explore intent: 'unde se află funcția sendMessage?'", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("unde se află funcția sendMessage?", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes Romanian explore intent: 'caută modulul de autentificare'", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("caută modulul de autentificare", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes Russian build intent: 'исправь ошибку в auth.ts'", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("исправь ошибку в auth.ts", "telegram");
    expect(agent).toBe("build");
  });

  it("routes Russian plan intent: 'спроектируй архитектуру системы'", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("спроектируй архитектуру системы", "telegram");
    expect(agent).toBe("plan");
  });

  it("routes Russian explore intent: 'где находится функция sendMessage'", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("где находится функция sendMessage", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes Russian explore intent: 'объясни что делает этот модуль'", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("объясни что делает этот модуль", "telegram");
    expect(agent).toBe("explore");
  });
});

describe("selectAgent() — short English commands", () => {
  it("routes 'fix auth.ts' to build (file extension pattern)", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("fix auth.ts", "telegram");
    expect(agent).toBe("build");
  });

  it("routes 'update utils.js' to build", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("update utils.js", "telegram");
    expect(agent).toBe("build");
  });

  it("routes 'where is sendMessage' to explore (short pattern)", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("where is sendMessage", "telegram");
    expect(agent).toBe("explore");
  });

  it("routes 'find the auth module' to explore", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("find the auth module", "telegram");
    expect(agent).toBe("explore");
  });

  it("still routes general non-English chat to chat", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("bună ziua, ce mai faci?", "telegram");
    expect(agent).toBe("chat");
  });

  it("still routes general Russian chat to chat", () => {
    const router = makeRouter();
    const agent = (router as any).selectAgent("привет, как дела?", "telegram");
    expect(agent).toBe("chat");
  });
});
