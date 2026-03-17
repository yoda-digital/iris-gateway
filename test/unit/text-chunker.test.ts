import { describe, it, expect } from "vitest";
import { chunkText, PLATFORM_LIMITS } from "../../src/utils/text-chunker.js";

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("returns single chunk when text is exactly maxLength", () => {
    const text = "a".repeat(100);
    expect(chunkText(text, 100)).toEqual([text]);
  });

  it("handles empty text", () => {
    expect(chunkText("", 100)).toEqual([""]);
  });

  it("splits at paragraph boundary (double newline)", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const chunks = chunkText(text, 35);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    // First chunk should end with the paragraph separator
    expect(chunks[0]).toContain("\n\n");
  });

  it("splits at sentence boundary (. followed by capital)", () => {
    const text = "First sentence. Second sentence. Third sentence here.";
    const chunks = chunkText(text, 35);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });

  it("splits at newline boundary (single newline, no paragraph)", () => {
    // No double-newlines, no sentence boundaries (no capital after period)
    // maxLength=30 → 30% threshold = 9 chars
    const text = "First line content here\nSecond line content goes on and on";
    const chunks = chunkText(text, 30);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    // First chunk must end at the newline
    expect(chunks[0]).toBe("First line content here\n");
  });

  it("splits at word boundary (space) when no other boundary", () => {
    const text = "word1 word2 word3 word4 word5 word6 word7";
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    // Each chunk should not exceed maxLength
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
  });

  it("hard cuts when no boundary found within threshold", () => {
    // No spaces, newlines, or punctuation — pure hard cut
    const text = "a".repeat(50);
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe("a".repeat(20));
    expect(chunks[1]).toBe("a".repeat(20));
    expect(chunks[2]).toBe("a".repeat(10));
    expect(chunks.join("")).toBe(text);
  });
});

describe("PLATFORM_LIMITS", () => {
  it("has telegram key", () => {
    expect(PLATFORM_LIMITS["telegram"]).toBe(4096);
  });

  it("has discord key", () => {
    expect(PLATFORM_LIMITS["discord"]).toBe(2000);
  });

  it("has whatsapp key", () => {
    expect(PLATFORM_LIMITS["whatsapp"]).toBe(65536);
  });

  it("has slack key", () => {
    expect(PLATFORM_LIMITS["slack"]).toBe(40000);
  });

  it("has all expected platform keys", () => {
    const keys = Object.keys(PLATFORM_LIMITS);
    expect(keys).toContain("telegram");
    expect(keys).toContain("discord");
    expect(keys).toContain("whatsapp");
    expect(keys).toContain("slack");
  });
});
