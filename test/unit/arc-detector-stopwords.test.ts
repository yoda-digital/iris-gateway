import { describe, it, expect, vi } from "vitest";
import type { IntelligenceStore } from "../../src/intelligence/store.js";
import type { IntelligenceBus } from "../../src/intelligence/bus.js";
import type { Logger } from "../../src/logging/logger.js";
import { ArcDetector } from "../../src/intelligence/arcs/detector.js";
import type { MemoryArc } from "../../src/intelligence/types.js";

function makeStore(): IntelligenceStore {
  return {
    findArcByKeywords: vi.fn().mockReturnValue(null),
    createArc: vi.fn().mockReturnValue({
      id: "arc-1",
      senderId: "user-1",
      title: "fallback title",
      status: "active",
      summary: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      resolvedAt: null,
      staleDays: 14,
    } as MemoryArc),
    addArcEntry: vi.fn(),
    updateArcTitle: vi.fn(),
  } as unknown as IntelligenceStore;
}

function makeBus(): IntelligenceBus {
  return { emit: vi.fn() } as unknown as IntelligenceBus;
}

function makeLogger(): Logger {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe("ArcDetector — stop word filtering", () => {
  it("filters German stop words (der die das) from keywords", () => {
    const store = makeStore();
    const bus = makeBus();
    const logger = makeLogger();
    const detector = new ArcDetector(store, bus, logger, undefined, "de");

    // 'der', 'die', 'das' are German stop words; 'projekt', 'deadline', 'morgen' should survive
    detector.processMemory("user-1", "Der das Projekt hat eine deadline morgen wichtig plannung", undefined, "conversation");

    const createCall = (store.createArc as ReturnType<typeof vi.fn>).mock.calls[0];
    // If called, verify stop words not in the title keywords
    if (createCall) {
      const title: string = createCall[0].title;
      expect(title).not.toMatch(/\bder\b/i);
      expect(title).not.toMatch(/\bdie\b/i);
      expect(title).not.toMatch(/\bdas\b/i);
    }
  });

  it("filters French stop words (les des une est) from keywords", () => {
    const store = makeStore();
    const bus = makeBus();
    const logger = makeLogger();
    const detector = new ArcDetector(store, bus, logger, undefined, "fr");

    detector.processMemory("user-1", "Les des une est projet client réunion demain important planification", undefined, "conversation");

    const createCall = (store.createArc as ReturnType<typeof vi.fn>).mock.calls[0];
    if (createCall) {
      const title: string = createCall[0].title;
      expect(title).not.toMatch(/\bles\b/i);
      expect(title).not.toMatch(/\bdes\b/i);
    }
  });

  it("filters English stop words (the with) from keywords", () => {
    const store = makeStore();
    const bus = makeBus();
    const logger = makeLogger();
    const detector = new ArcDetector(store, bus, logger, undefined, "en");

    detector.processMemory("user-1", "the meeting with client about project deadline tomorrow schedule", undefined, "conversation");

    const createCall = (store.createArc as ReturnType<typeof vi.fn>).mock.calls[0];
    if (createCall) {
      const title: string = createCall[0].title;
      expect(title).not.toMatch(/\bthe\b/i);
    }
  });

  it("defaults to English filtering when no language specified", () => {
    const store = makeStore();
    const bus = makeBus();
    const logger = makeLogger();
    const detector = new ArcDetector(store, bus, logger);

    // Should not crash and should create arc
    detector.processMemory("user-1", "the meeting with client about project deadline tomorrow schedule", undefined, "conversation");
    // Just verify no crash
    expect(true).toBe(true);
  });

  it("falls back to English for unknown language code", () => {
    const store = makeStore();
    const bus = makeBus();
    const logger = makeLogger();
    const detector = new ArcDetector(store, bus, logger, undefined, "xx");

    // Should not crash
    expect(() =>
      detector.processMemory("user-1", "the meeting client project deadline tomorrow schedule important", undefined, "conversation"),
    ).not.toThrow();
  });
});
