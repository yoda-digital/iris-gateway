import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArcDetector } from "../../src/intelligence/arcs/detector.js";
import type { IntelligenceStore } from "../../src/intelligence/store.js";
import type { IntelligenceBus } from "../../src/intelligence/bus.js";
import type { Logger } from "../../src/logging/logger.js";

function makeStore(overrides: Partial<IntelligenceStore> = {}): IntelligenceStore {
  return {
    findArcByKeywords: vi.fn().mockReturnValue(null),
    createArc: vi.fn().mockReturnValue({ id: "arc-1", title: "test", senderId: "u1", status: "active" }),
    addArcEntry: vi.fn(),
    getActiveArcs: vi.fn().mockReturnValue([]),
    getStaleArcs: vi.fn().mockReturnValue([]),
    updateArcStatus: vi.fn(),
    ...overrides,
  } as unknown as IntelligenceStore;
}

function makeBus(): IntelligenceBus {
  return { emit: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() } as unknown as IntelligenceBus;
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe("ArcDetector", () => {
  let store: IntelligenceStore;
  let bus: IntelligenceBus;
  let logger: Logger;
  let detector: ArcDetector;

  beforeEach(() => {
    store = makeStore();
    bus = makeBus();
    logger = makeLogger();
    detector = new ArcDetector(store, bus, logger);
  });

  it("extracts keywords from English text", () => {
    detector.processMemory("u1", "User is planning a wedding ceremony in June");
    expect(store.findArcByKeywords).toHaveBeenCalledWith(
      "u1",
      expect.arrayContaining(["planning", "wedding", "ceremony", "june"]),
    );
  });

  it("extracts keywords from Cyrillic text", () => {
    detector.processMemory("u1", "Пользователь ищет новую работу программистом");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("u1");
    const keywords: string[] = call[1];
    expect(keywords.length).toBeGreaterThanOrEqual(2);
    expect(keywords.some((k) => /[\u0400-\u04ff]/u.test(k))).toBe(true);
  });

  it("extracts keywords from Romanian text with diacritics", () => {
    detector.processMemory("u1", "Utilizatorul vrea să termine proiectul de renovare");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    const keywords: string[] = call[1];
    expect(keywords.length).toBeGreaterThanOrEqual(2);
    expect(keywords).toContain("termine");
    expect(keywords).toContain("proiectul");
    expect(keywords).toContain("renovare");
  });

  it("preserves diacritics in keywords", () => {
    detector.processMemory("u1", "Mâine trebuie să finalizeze ședința despre proiect");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    const keywords: string[] = call[1];
    expect(keywords.some((k) => k.includes("ș") || k.includes("ț") || k.includes("â"))).toBe(true);
  });

  it("handles mixed-language text", () => {
    detector.processMemory("u1", "Tomorrow voi merge la gym pentru antrenament");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    const keywords: string[] = call[1];
    expect(keywords.length).toBeGreaterThanOrEqual(2);
    expect(keywords).toContain("tomorrow");
    expect(keywords).toContain("antrenament");
  });

  it("filters short tokens (<3 chars)", () => {
    detector.processMemory("u1", "I am at the gym to do a big run for my new plan");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    const keywords: string[] = call[1];
    for (const kw of keywords) {
      expect(kw.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("skips content with fewer than 2 keywords", () => {
    detector.processMemory("u1", "ok");
    expect(store.findArcByKeywords).not.toHaveBeenCalled();
  });
});
