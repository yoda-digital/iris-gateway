/**
 * Unit tests for src/gateway/intelligence-wiring.ts
 * Tests the initIntelligence() factory function.
 * Issue #107 — coverage fix
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VaultDB } from "../../src/vault/db.js";
import { HeartbeatStore } from "../../src/heartbeat/store.js";
import { initIntelligence } from "../../src/gateway/intelligence-wiring.js";

function makeLogger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

describe("initIntelligence()", () => {
  let dir: string;
  let db: VaultDB;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "iris-intel-wiring-"));
    db = new VaultDB(dir);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns all required components", () => {
    const result = initIntelligence(db, null, null, null, makeLogger());

    expect(result.intelligenceBus).toBeDefined();
    expect(result.intelligenceStore).toBeDefined();
    expect(result.triggerEvaluator).toBeDefined();
    expect(result.outcomeAnalyzer).toBeDefined();
    expect(result.arcDetector).toBeDefined();
    expect(result.arcLifecycle).toBeDefined();
    expect(result.goalLifecycle).toBeDefined();
    expect(result.crossChannelResolver).toBeDefined();
    expect(result.promptAssembler).toBeDefined();
  });

  it("returns null inferenceEngine when signalStore is null", () => {
    const result = initIntelligence(db, null, null, null, makeLogger());
    expect(result.inferenceEngine).toBeNull();
  });

  it("creates inferenceEngine when signalStore is provided", () => {
    const signalStore = {
      getSignals: vi.fn().mockReturnValue([]),
      addSignal: vi.fn(),
      getLatestSignal: vi.fn().mockReturnValue(null),
    } as any;

    const result = initIntelligence(db, signalStore, null, null, makeLogger());
    expect(result.inferenceEngine).not.toBeNull();
  });

  it("returns null trendDetector and healthGate when heartbeatStore is null", () => {
    const result = initIntelligence(db, null, null, null, makeLogger());
    expect(result.trendDetector).toBeNull();
    expect(result.healthGate).toBeNull();
  });

  it("creates trendDetector and healthGate when heartbeatStore is provided", () => {
    const heartbeatStore = new HeartbeatStore(db);

    const result = initIntelligence(db, null, null, heartbeatStore, makeLogger());
    expect(result.trendDetector).not.toBeNull();
    expect(result.healthGate).not.toBeNull();
  });

  it("accepts intentStore parameter", () => {
    const intentStore = {
      addIntent: vi.fn(),
      listPendingIntents: vi.fn().mockReturnValue([]),
    } as any;

    const result = initIntelligence(db, null, intentStore, null, makeLogger());
    expect(result.triggerEvaluator).toBeDefined();
  });

  it("accepts titleGenerator function parameter", () => {
    const titleGenerator = vi.fn().mockResolvedValue("Test Title");

    const result = initIntelligence(db, null, null, null, makeLogger(), titleGenerator);
    expect(result.arcDetector).toBeDefined();
  });

  it("accepts optional userLanguage parameter", () => {
    const result = initIntelligence(db, null, null, null, makeLogger(), undefined, "fr");
    expect(result.arcDetector).toBeDefined();
  });

  it("initializes all components with signalStore and heartbeatStore provided", () => {
    const signalStore = {
      getSignals: vi.fn().mockReturnValue([]),
      addSignal: vi.fn(),
      getLatestSignal: vi.fn().mockReturnValue(null),
    } as any;
    const heartbeatStore = new HeartbeatStore(db);

    const result = initIntelligence(db, signalStore, null, heartbeatStore, makeLogger());

    expect(result.inferenceEngine).not.toBeNull();
    expect(result.trendDetector).not.toBeNull();
    expect(result.healthGate).not.toBeNull();
    expect(result.intelligenceBus).toBeDefined();
    expect(result.promptAssembler).toBeDefined();
  });

  it("logs initialization message", () => {
    const logger = makeLogger();
    initIntelligence(db, null, null, null, logger);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Intelligence layer initialized"));
  });
});
