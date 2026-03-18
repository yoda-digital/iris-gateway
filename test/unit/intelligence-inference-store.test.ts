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

  describe("writeDerivedSignal edge cases", () => {
    it("stores channelId on signal", () => {
      const s = store.writeDerivedSignal({ senderId: "s2", channelId: "ch1", signalType: "lang", value: "ro" });
      expect(s.channelId).toBe("ch1");
    });

    it("treats same sender+type with different channelId as separate signals", () => {
      store.writeDerivedSignal({ senderId: "s3", channelId: "ch1", signalType: "lang", value: "ro" });
      store.writeDerivedSignal({ senderId: "s3", channelId: "ch2", signalType: "lang", value: "en" });
      const all = store.getDerivedSignals("s3", "lang");
      expect(all).toHaveLength(2);
    });

    it("updates signal that matches sender+type+channel", () => {
      store.writeDerivedSignal({ senderId: "s4", channelId: "ch1", signalType: "lang", value: "ro" });
      const updated = store.writeDerivedSignal({ senderId: "s4", channelId: "ch1", signalType: "lang", value: "en" });
      expect(updated.value).toBe("en");
      expect(store.getDerivedSignals("s4", "lang")).toHaveLength(1);
    });

    it("stores evidence and expiresAt", () => {
      const expiresAt = Date.now() + 10000;
      const s = store.writeDerivedSignal({
        senderId: "s5", signalType: "tone", value: "formal",
        evidence: "said please", expiresAt,
      });
      expect(s.evidence).toBe("said please");
      expect(s.expiresAt).toBe(expiresAt);
    });

    it("defaults evidence and expiresAt to null", () => {
      const s = store.writeDerivedSignal({ senderId: "s6", signalType: "lang", value: "ro" });
      expect(s.evidence).toBeNull();
      expect(s.expiresAt).toBeNull();
    });
  });

  describe("getDerivedSignal by id", () => {
    it("returns null for unknown id", () => {
      expect(store.getDerivedSignal("does-not-exist")).toBeNull();
    });

    it("returns full signal for known id", () => {
      const created = store.writeDerivedSignal({ senderId: "s7", signalType: "lang", value: "ro", confidence: 0.75 });
      const found = store.getDerivedSignal(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.confidence).toBe(0.75);
    });
  });

  describe("logInference edge cases", () => {
    it("stores null result and null details", () => {
      store.logInference({ ruleId: "r2", senderId: "s1", result: null, details: null, executedAt: 2000 });
      const last = store.getLastInferenceRun("r2", "s1");
      expect(last).toBe(2000);
    });

    it("stores JSON string details", () => {
      const details = JSON.stringify({ matched: true, score: 0.9 });
      store.logInference({ ruleId: "r3", senderId: "s1", result: "produced", details, executedAt: 3000 });
      expect(store.getLastInferenceRun("r3", "s1")).toBe(3000);
    });

    it("getLastInferenceRun ignores other senders", () => {
      store.logInference({ ruleId: "r4", senderId: "s-other", result: "ok", details: null, executedAt: 9999 });
      expect(store.getLastInferenceRun("r4", "s-mine")).toBeNull();
    });
  });
});
