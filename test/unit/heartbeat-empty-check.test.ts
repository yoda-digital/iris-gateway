import { describe, it, expect } from "vitest";
import { shouldSkipEmptyCheck, computeBackoffInterval, type EmptyCheckState } from "../../src/heartbeat/empty-check.js";

describe("shouldSkipEmptyCheck", () => {
  it("returns false when disabled", () => {
    const state: EmptyCheckState = { previousHash: "", consecutiveEmpty: 0 };
    expect(shouldSkipEmptyCheck(false, state, "abc123")).toBe(false);
  });

  it("returns false when hash changes", () => {
    const state: EmptyCheckState = { previousHash: "old", consecutiveEmpty: 2 };
    const result = shouldSkipEmptyCheck(true, state, "new");
    expect(result).toBe(false);
    expect(state.consecutiveEmpty).toBe(0);
    expect(state.previousHash).toBe("new");
  });

  it("returns true when hash matches (all healthy unchanged)", () => {
    const state: EmptyCheckState = { previousHash: "abc", consecutiveEmpty: 0 };
    const result = shouldSkipEmptyCheck(true, state, "abc");
    expect(result).toBe(true);
    expect(state.consecutiveEmpty).toBe(1);
  });

  it("increments consecutiveEmpty on repeated match", () => {
    const state: EmptyCheckState = { previousHash: "abc", consecutiveEmpty: 5 };
    shouldSkipEmptyCheck(true, state, "abc");
    expect(state.consecutiveEmpty).toBe(6);
  });
});

describe("computeBackoffInterval", () => {
  it("returns base interval when consecutiveEmpty is 0", () => {
    expect(computeBackoffInterval(60_000, 0, 300_000)).toBe(60_000);
  });

  it("doubles interval per consecutive empty tick", () => {
    expect(computeBackoffInterval(60_000, 1, 300_000)).toBe(120_000);
    expect(computeBackoffInterval(60_000, 2, 300_000)).toBe(240_000);
  });

  it("caps at maxBackoffMs", () => {
    expect(computeBackoffInterval(60_000, 10, 300_000)).toBe(300_000);
  });

  it("returns base interval when maxBackoffMs is 0 (disabled)", () => {
    expect(computeBackoffInterval(60_000, 5, 0)).toBe(60_000);
  });
});
