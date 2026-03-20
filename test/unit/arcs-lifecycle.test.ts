import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArcLifecycle } from "../../src/intelligence/arcs/lifecycle.js";
import type { IntelligenceStore } from "../../src/intelligence/store.js";
import type { IntelligenceBus } from "../../src/intelligence/bus.js";
import type { Logger } from "../../src/logging/logger.js";
import type { MemoryArc } from "../../src/intelligence/types.js";

function makeArc(overrides: Partial<MemoryArc> = {}): MemoryArc {
  return {
    id: "arc-1",
    senderId: "u1",
    title: "Test Arc",
    status: "active",
    summary: null,
    createdAt: Date.now() - 3_600_000,
    updatedAt: Date.now() - 1_800_000,
    resolvedAt: null,
    staleDays: 7,
    ...overrides,
  };
}

function makeStore(overrides: Partial<IntelligenceStore> = {}): IntelligenceStore {
  return {
    getArc: vi.fn().mockReturnValue(makeArc()),
    addArcEntry: vi.fn(),
    updateArcStatus: vi.fn(),
    getActiveArcs: vi.fn().mockReturnValue([]),
    getArcEntries: vi.fn().mockReturnValue([]),
    getStaleArcs: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as IntelligenceStore;
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe("ArcLifecycle", () => {
  let store: IntelligenceStore;
  let bus: IntelligenceBus;
  let logger: Logger;
  let lifecycle: ArcLifecycle;

  beforeEach(() => {
    store = makeStore();
    bus = {} as IntelligenceBus;
    logger = makeLogger();
    lifecycle = new ArcLifecycle(store, bus, logger);
  });

  describe("resolve()", () => {
    it("calls updateArcStatus with 'resolved'", () => {
      lifecycle.resolve("arc-1");
      expect(store.updateArcStatus).toHaveBeenCalledWith("arc-1", "resolved");
    });

    it("logs info", () => {
      lifecycle.resolve("arc-1");
      expect(logger.info).toHaveBeenCalledWith({ arcId: "arc-1" }, "Arc resolved");
    });

    it("adds summary entry when summary provided and arc exists", () => {
      lifecycle.resolve("arc-1", "All done!");
      expect(store.addArcEntry).toHaveBeenCalledWith(
        expect.objectContaining({ content: "[RESOLVED] All done!", source: "tool" })
      );
    });

    it("does NOT add entry when no summary", () => {
      lifecycle.resolve("arc-1");
      expect(store.addArcEntry).not.toHaveBeenCalled();
    });

    it("does NOT add entry when arc not found", () => {
      (store.getArc as ReturnType<typeof vi.fn>).mockReturnValue(null);
      lifecycle.resolve("arc-1", "summary");
      expect(store.addArcEntry).not.toHaveBeenCalled();
      expect(store.updateArcStatus).toHaveBeenCalledWith("arc-1", "resolved");
    });
  });

  describe("abandon()", () => {
    it("calls updateArcStatus with 'abandoned'", () => {
      lifecycle.abandon("arc-1");
      expect(store.updateArcStatus).toHaveBeenCalledWith("arc-1", "abandoned");
    });

    it("logs info", () => {
      lifecycle.abandon("arc-1");
      expect(logger.info).toHaveBeenCalledWith({ arcId: "arc-1" }, "Arc abandoned");
    });
  });

  describe("reactivate()", () => {
    it("calls updateArcStatus with 'active'", () => {
      lifecycle.reactivate("arc-1");
      expect(store.updateArcStatus).toHaveBeenCalledWith("arc-1", "active");
    });

    it("logs info", () => {
      lifecycle.reactivate("arc-1");
      expect(logger.info).toHaveBeenCalledWith({ arcId: "arc-1" }, "Arc reactivated");
    });
  });

  describe("getArcContext()", () => {
    it("returns null when no active arcs", () => {
      const result = lifecycle.getArcContext("u1");
      expect(result).toBeNull();
    });

    it("returns formatted string with active arcs", () => {
      const arc = makeArc({ summary: "Some progress made" });
      (store.getActiveArcs as ReturnType<typeof vi.fn>).mockReturnValue([arc]);
      (store.getArcEntries as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = lifecycle.getArcContext("u1");
      expect(result).not.toBeNull();
      expect(result).toContain("[ACTIVE NARRATIVE ARCS]");
      expect(result).toContain("Test Arc");
      expect(result).toContain("Some progress made");
    });

    it("limits to 5 arcs", () => {
      const arcs = Array.from({ length: 8 }, (_, i) => makeArc({ id: `arc-${i}`, title: `Arc ${i}` }));
      (store.getActiveArcs as ReturnType<typeof vi.fn>).mockReturnValue(arcs);
      (store.getArcEntries as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = lifecycle.getArcContext("u1")!;
      // Should contain exactly 5 arc lines
      const arcLines = result.split("\n").filter((l) => l.startsWith("- "));
      expect(arcLines).toHaveLength(5);
    });

    it("truncates summary to 120 chars", () => {
      const longSummary = "x".repeat(200);
      const arc = makeArc({ summary: longSummary });
      (store.getActiveArcs as ReturnType<typeof vi.fn>).mockReturnValue([arc]);
      (store.getArcEntries as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = lifecycle.getArcContext("u1")!;
      expect(result).toContain("x".repeat(120));
      expect(result).not.toContain("x".repeat(121));
    });

    it("formats age in hours for recent arcs", () => {
      const arc = makeArc({ createdAt: Date.now() - 2 * 3_600_000, updatedAt: Date.now() - 3_600_000 });
      (store.getActiveArcs as ReturnType<typeof vi.fn>).mockReturnValue([arc]);
      (store.getArcEntries as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = lifecycle.getArcContext("u1")!;
      expect(result).toContain("h old");
      expect(result).toContain("h ago");
    });
  });

  describe("getStaleArcsForFollowUp()", () => {
    it("returns stale arcs filtered by senderId", () => {
      const stale = [
        makeArc({ id: "arc-1", senderId: "u1", status: "stale" }),
        makeArc({ id: "arc-2", senderId: "u2", status: "stale" }),
      ];
      (store.getStaleArcs as ReturnType<typeof vi.fn>).mockReturnValue(stale);

      const result = lifecycle.getStaleArcsForFollowUp("u1");
      expect(result).toHaveLength(1);
      expect(result[0].senderId).toBe("u1");
    });

    it("returns empty array when no stale arcs for sender", () => {
      (store.getStaleArcs as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const result = lifecycle.getStaleArcsForFollowUp("u1");
      expect(result).toHaveLength(0);
    });
  });
});
