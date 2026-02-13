import { describe, it, expect } from "vitest";
import { chunkText, PLATFORM_LIMITS } from "../../src/utils/text-chunker.js";

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("splits on paragraph boundaries", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const chunks = chunkText(text, 35);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });

  it("splits on sentence boundaries", () => {
    const text = "First sentence. Second sentence. Third sentence here.";
    const chunks = chunkText(text, 35);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });

  it("splits on word boundaries as fallback", () => {
    const text = "word1 word2 word3 word4 word5 word6 word7";
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });

  it("hard cuts when no boundaries found", () => {
    const text = "a".repeat(50);
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBe(3);
    expect(chunks.join("")).toBe(text);
  });

  it("handles empty text", () => {
    expect(chunkText("", 100)).toEqual([""]);
  });

  it("handles text exactly at limit", () => {
    const text = "a".repeat(100);
    expect(chunkText(text, 100)).toEqual([text]);
  });
});

describe("PLATFORM_LIMITS", () => {
  it("has correct Telegram limit", () => {
    expect(PLATFORM_LIMITS["telegram"]).toBe(4096);
  });

  it("has correct Discord limit", () => {
    expect(PLATFORM_LIMITS["discord"]).toBe(2000);
  });

  it("has correct WhatsApp limit", () => {
    expect(PLATFORM_LIMITS["whatsapp"]).toBe(65536);
  });

  it("has correct Slack limit", () => {
    expect(PLATFORM_LIMITS["slack"]).toBe(40000);
  });
});
