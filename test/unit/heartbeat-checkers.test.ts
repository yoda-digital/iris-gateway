import { describe, it, expect, vi } from "vitest";
import {
  BridgeChecker,
  ChannelChecker,
  VaultChecker,
  SessionChecker,
  MemoryChecker,
} from "../../src/heartbeat/checkers.js";

describe("BridgeChecker", () => {
  it("returns healthy when bridge responds", async () => {
    const checker = new BridgeChecker({
      checkHealth: vi.fn().mockResolvedValue(true),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("healthy");
    expect(result.component).toBe("bridge");
  });

  it("returns down when bridge fails", async () => {
    const checker = new BridgeChecker({
      checkHealth: vi.fn().mockResolvedValue(false),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("down");
  });
});

describe("ChannelChecker", () => {
  it("returns healthy when all connected", async () => {
    const checker = new ChannelChecker({
      list: vi.fn().mockReturnValue([
        { id: "tg", isConnected: true },
        { id: "dc", isConnected: true },
      ]),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("healthy");
  });

  it("returns degraded when some disconnected", async () => {
    const checker = new ChannelChecker({
      list: vi.fn().mockReturnValue([
        { id: "tg", isConnected: true },
        { id: "dc", isConnected: false },
      ]),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("degraded");
  });

  it("returns down when none connected", async () => {
    const checker = new ChannelChecker({
      list: vi.fn().mockReturnValue([
        { id: "tg", isConnected: false },
        { id: "dc", isConnected: false },
      ]),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("down");
  });

  it("returns healthy when no adapters", async () => {
    const checker = new ChannelChecker({
      list: vi.fn().mockReturnValue([]),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("healthy");
  });
});

describe("VaultChecker", () => {
  it("returns healthy when db is open and ok", async () => {
    const checker = new VaultChecker({
      isOpen: vi.fn().mockReturnValue(true),
      raw: vi.fn().mockReturnValue({
        pragma: vi.fn().mockReturnValue([{ integrity_check: "ok" }]),
      }),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("healthy");
  });

  it("returns down when db is closed", async () => {
    const checker = new VaultChecker({
      isOpen: vi.fn().mockReturnValue(false),
      raw: vi.fn(),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("down");
  });

  it("returns degraded when integrity check fails", async () => {
    const checker = new VaultChecker({
      isOpen: vi.fn().mockReturnValue(true),
      raw: vi.fn().mockReturnValue({
        pragma: vi.fn().mockReturnValue([{ integrity_check: "failed" }]),
      }),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("degraded");
  });
});

describe("SessionChecker", () => {
  const now = Date.now();
  const STALE_MS = 24 * 60 * 60 * 1000;

  it("returns healthy with empty sessions", async () => {
    const checker = new SessionChecker({
      list: vi.fn().mockResolvedValue([]),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("healthy");
    expect(result.component).toBe("sessions");
  });

  it("returns healthy when stale sessions <= 10", async () => {
    // 5 stale sessions (>24h old)
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      lastActiveAt: now - STALE_MS - 1000,
    }));
    const checker = new SessionChecker({
      list: vi.fn().mockResolvedValue(entries),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("healthy");
  });

  it("returns degraded when stale sessions > 10", async () => {
    // 11 stale sessions
    const entries = Array.from({ length: 11 }, (_, i) => ({
      id: String(i),
      lastActiveAt: now - STALE_MS - 1000,
    }));
    const checker = new SessionChecker({
      list: vi.fn().mockResolvedValue(entries),
    } as any);
    const result = await checker.check();
    expect(result.status).toBe("degraded");
    expect(result.details).toContain("stale=11");
  });
});

describe("MemoryChecker", () => {
  it("returns healthy under normal memory", async () => {
    const checker = new MemoryChecker();
    const result = await checker.check();
    expect(result.status).toBe("healthy");
    expect(result.component).toBe("memory");
  });

  it("returns degraded when heap > 512MB", async () => {
    vi.spyOn(process, "memoryUsage").mockReturnValueOnce({
      heapUsed: 600 * 1024 * 1024,
      heapTotal: 700 * 1024 * 1024,
      rss: 800 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    });
    const checker = new MemoryChecker();
    const result = await checker.check();
    expect(result.status).toBe("degraded");
    expect(result.details).toContain("heap=600MB");
  });

  it("returns down when heap > 1024MB", async () => {
    vi.spyOn(process, "memoryUsage").mockReturnValueOnce({
      heapUsed: 1100 * 1024 * 1024,
      heapTotal: 1200 * 1024 * 1024,
      rss: 1300 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    });
    const checker = new MemoryChecker();
    const result = await checker.check();
    expect(result.status).toBe("down");
    expect(result.details).toContain("heap=1100MB");
  });
});
