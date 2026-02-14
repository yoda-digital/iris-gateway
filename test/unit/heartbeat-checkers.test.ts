import { describe, it, expect, vi } from "vitest";
import {
  BridgeChecker,
  ChannelChecker,
  VaultChecker,
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
});

describe("MemoryChecker", () => {
  it("returns healthy under normal memory", async () => {
    const checker = new MemoryChecker();
    const result = await checker.check();
    expect(result.status).toBe("healthy");
    expect(result.component).toBe("memory");
  });
});
