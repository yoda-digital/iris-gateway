import { describe, it, expect, vi, beforeEach } from "vitest";

const { initIntelligenceMock } = vi.hoisted(() => ({
  initIntelligenceMock: vi.fn(),
}));

vi.mock("../../src/gateway/intelligence-wiring.js", () => ({
  initIntelligence: initIntelligenceMock,
}));

import { bootstrapIntelligence } from "../../src/gateway/intelligence-bootstrap.js";

describe("bootstrapIntelligence()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the exact object from initIntelligence and passes userLanguage", () => {
    const expected = { intelligenceBus: {}, trendDetector: null } as any;
    initIntelligenceMock.mockReturnValue(expected);

    const bridge = { createSession: vi.fn(), sendMessage: vi.fn(), deleteSession: vi.fn() } as any;
    const logger = { warn: vi.fn() } as any;

    const result = bootstrapIntelligence(bridge, {} as any, null, null, null, logger, "fr");

    expect(result).toBe(expected);
    expect(initIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(initIntelligenceMock.mock.calls[0][6]).toBe("fr");
    expect(typeof initIntelligenceMock.mock.calls[0][5]).toBe("function");
  });

  it("logs warning if title generator session cleanup fails", async () => {
    initIntelligenceMock.mockReturnValue({});

    const bridge = {
      createSession: vi.fn().mockResolvedValue({ id: "s1" }),
      sendMessage: vi.fn().mockResolvedValue('"Arc title"'),
      deleteSession: vi.fn().mockRejectedValue(new Error("delete failed")),
    } as any;
    const logger = { warn: vi.fn() } as any;

    bootstrapIntelligence(bridge, {} as any, null, null, null, logger);

    const titleGenerator = initIntelligenceMock.mock.calls[0][5] as (k: string[], c: string) => Promise<string>;
    await titleGenerator(["goal"], "Body text");
    await Promise.resolve();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", err: expect.any(Error) }),
      "Failed to delete title generation session",
    );
  });
});
