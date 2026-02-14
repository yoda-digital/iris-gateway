import { describe, it, expect } from "vitest";
import { categorizeIntent } from "../../src/intelligence/outcomes/categorizer.js";

const VALID_CATEGORIES = ["task", "work", "health", "hobby", "social", "reminder", "general"];

describe("categorizeIntent", () => {
  it("returns provided category when valid", () => {
    expect(categorizeIntent("anything", "task")).toBe("task");
    expect(categorizeIntent("anything", "health")).toBe("health");
    expect(categorizeIntent("anything", "social")).toBe("social");
  });

  it("returns 'general' when no category provided", () => {
    expect(categorizeIntent("some text")).toBe("general");
    expect(categorizeIntent("some text", undefined)).toBe("general");
  });

  it("returns 'general' for invalid category", () => {
    expect(categorizeIntent("text", "invalid")).toBe("general");
    expect(categorizeIntent("text", "")).toBe("general");
  });

  it("accepts all valid categories", () => {
    for (const cat of VALID_CATEGORIES) {
      expect(categorizeIntent("x", cat)).toBe(cat);
    }
  });
});
