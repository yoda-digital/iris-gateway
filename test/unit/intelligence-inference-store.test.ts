import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { InferenceStore } from "../../src/intelligence/inference/store.js";
import type { VaultDB } from "../../src/vault/db.js";

function makeVaultDB(): VaultDB {
  const db = new Database(":memory:");
  return { raw: () => db } as unknown as VaultDB;
}

describe("InferenceStore", () => {
  let store: InferenceStore;
  beforeEach(() => { store = new InferenceStore(makeVaultDB()); });

  it("writeDerivedSignal creates new signal", () => {
    const s = store.writeDerivedSignal({ senderId: "s1", signalType: "lang", value: "ro", confidence: 0.9 });
    expect(s.id).toBeTruthy();
    expect(s.senderId).toBe("s1");
    expect(s.signalType).toBe("lang");
    expect(s.value).toBe("ro");
    expect(s.confidence).toBe(0.9);
  });

  it("writeDerivedSignal updates existing signal same sender+type", () => {
    store.writeDerivedSignal({ senderId: "s1", signalType: "lang", value: "ro" });
    const updated = store.writeDerivedSignal({ senderId: "s1", signalType: "lang", value: "en", confidence: 0.8 });
    expect(updated.value).toBe("en");
    expect(store.getDerivedSignals("s1", "lang")).toHaveLength(1);
  });

  it("writeDerivedSignal defaults confidence to 0.5", () => {
    const s = store.writeDerivedSignal({ senderId: "s1", signalType: "x", value: "v" });
    expect(s.confidence).toBe(0.5);
  });

  it("getDerivedSignals returns empty for unknown sender", () => {
    expect(store.getDerivedSignals("ghost")).toEqual([]);
  });

  it("getDerivedSignals filters by signalType", () => {
    store.writeDerivedSignal({ senderId: "s1", signalType: "lang", value: "ro" });
    store.writeDerivedSignal({ senderId: "s1", signalType: "tone", value: "formal" });
    expect(store.getDerivedSignals("s1", "lang")).toHaveLength(1);
    expect(store.getDerivedSignals("s1", "lang")[0].signalType).toBe("lang");
  });

  it("getDerivedSignals without filter returns all", () => {
    store.writeDerivedSignal({ senderId: "s1", signalType: "lang", value: "ro" });
    store.writeDerivedSignal({ senderId: "s1", signalType: "tone", value: "formal" });
    expect(store.getDerivedSignals("s1")).toHaveLength(2);
  });

  it("logInference stores entry", () => {
    store.logInference({ ruleId: "r1", senderId: "s1", result: "produced", details: null, executedAt: 1000 });
    const last = store.getLastInferenceRun("r1", "s1");
    expect(last).toBe(1000);
  });

  it("getLastInferenceRun returns null for unknown rule", () => {
    expect(store.getLastInferenceRun("ghost", "s1")).toBeNull();
  });

  it("getLastInferenceRun returns latest executedAt", () => {
    store.logInference({ ruleId: "r1", senderId: "s1", result: "skipped", details: null, executedAt: 1000 });
    store.logInference({ ruleId: "r1", senderId: "s1", result: "produced", details: null, executedAt: 5000 });
    expect(store.getLastInferenceRun("r1", "s1")).toBe(5000);
  });
});
