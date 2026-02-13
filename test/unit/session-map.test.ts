import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionMap } from "../../src/bridge/session-map.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";

describe("SessionMap", () => {
  let tempDir: string;
  let sessionMap: SessionMap;
  let bridge: MockOpenCodeBridge;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-test-"));
    sessionMap = new SessionMap(tempDir);
    bridge = new MockOpenCodeBridge();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("builds correct keys", () => {
    expect(sessionMap.buildKey("telegram", "123", "dm")).toBe(
      "telegram:dm:123",
    );
    expect(sessionMap.buildKey("discord", "456", "group")).toBe(
      "discord:group:456",
    );
  });

  it("creates new session on first resolve", async () => {
    const entry = await sessionMap.resolve(
      "telegram",
      "user1",
      "chat1",
      "dm",
      bridge as any,
    );
    expect(entry.openCodeSessionId).toMatch(/^mock-session-/);
    expect(entry.channelId).toBe("telegram");
    expect(entry.senderId).toBe("user1");
  });

  it("returns existing session on subsequent resolves", async () => {
    const entry1 = await sessionMap.resolve(
      "telegram",
      "user1",
      "chat1",
      "dm",
      bridge as any,
    );
    const entry2 = await sessionMap.resolve(
      "telegram",
      "user1",
      "chat1",
      "dm",
      bridge as any,
    );
    expect(entry1.openCodeSessionId).toBe(entry2.openCodeSessionId);
  });

  it("creates different sessions for different chats", async () => {
    const entry1 = await sessionMap.resolve(
      "telegram",
      "user1",
      "chat1",
      "dm",
      bridge as any,
    );
    const entry2 = await sessionMap.resolve(
      "discord",
      "user1",
      "chat2",
      "dm",
      bridge as any,
    );
    expect(entry1.openCodeSessionId).not.toBe(entry2.openCodeSessionId);
  });

  it("resets a session", async () => {
    await sessionMap.resolve("telegram", "user1", "chat1", "dm", bridge as any);
    const key = sessionMap.buildKey("telegram", "chat1", "dm");
    await sessionMap.reset(key);
    const entries = await sessionMap.list();
    expect(entries).toHaveLength(0);
  });

  it("persists sessions across instances", async () => {
    await sessionMap.resolve("telegram", "user1", "chat1", "dm", bridge as any);

    const sessionMap2 = new SessionMap(tempDir);
    const entries = await sessionMap2.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.channelId).toBe("telegram");
  });
});
