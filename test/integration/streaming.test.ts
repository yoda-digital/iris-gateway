import { describe, it, expect } from "vitest";
import { StreamCoalescer, type CoalescerConfig } from "../../src/bridge/stream-coalescer.js";

function makeConfig(overrides: Partial<CoalescerConfig> = {}): CoalescerConfig {
  return {
    enabled: true,
    minChars: 10,
    maxChars: 200,
    idleMs: 50,
    breakOn: "sentence",
    editInPlace: false,
    ...overrides,
  };
}

describe("Integration: Streaming Pipeline", () => {
  it("coalesces multiple deltas into a single idle flush", async () => {
    const flushes: Array<{ text: string; isEdit: boolean }> = [];
    const coalescer = new StreamCoalescer(
      makeConfig({ minChars: 5 }),
      (text, isEdit) => { flushes.push({ text, isEdit }); },
    );

    // Feed small deltas rapidly
    coalescer.append("Hello ");
    coalescer.append("world. ");
    coalescer.append("This is a test.");

    // Wait for idle flush (idleMs=50, wait 150 to be safe)
    await new Promise((r) => setTimeout(r, 150));

    expect(flushes.length).toBeGreaterThanOrEqual(1);
    const fullText = flushes.map((f) => f.text).join("");
    expect(fullText).toBe("Hello world. This is a test.");
  });

  it("flushes at maxChars boundary on sentence break", () => {
    const flushes: Array<{ text: string; isEdit: boolean }> = [];
    const coalescer = new StreamCoalescer(
      makeConfig({ maxChars: 30 }),
      (text, isEdit) => { flushes.push({ text, isEdit }); },
    );

    // Feed text that exceeds maxChars
    coalescer.append("Short sentence. Another sentence that is longer than thirty chars.");

    // Should have flushed at sentence boundary within maxChars
    expect(flushes.length).toBeGreaterThanOrEqual(1);
    expect(flushes[0].text).toContain("Short sentence.");
  });

  it("emits edit-in-place updates when enabled", async () => {
    const flushes: Array<{ text: string; isEdit: boolean }> = [];
    const coalescer = new StreamCoalescer(
      makeConfig({ editInPlace: true, minChars: 5 }),
      (text, isEdit) => { flushes.push({ text, isEdit }); },
    );

    coalescer.append("First chunk.");

    // Wait for idle
    await new Promise((r) => setTimeout(r, 150));
    expect(flushes.length).toBe(1);
    expect(flushes[0].isEdit).toBe(false); // First flush is not edit

    // Append more
    coalescer.append(" Second chunk.");
    await new Promise((r) => setTimeout(r, 150));

    // Second flush should be an edit (isEdit = true) with full text
    expect(flushes.length).toBe(2);
    expect(flushes[1].isEdit).toBe(true);
    expect(flushes[1].text).toBe("First chunk. Second chunk.");
  });

  it("end() flushes remaining buffer", () => {
    const flushes: Array<{ text: string; isEdit: boolean }> = [];
    const coalescer = new StreamCoalescer(
      makeConfig({ idleMs: 10_000 }),
      (text, isEdit) => { flushes.push({ text, isEdit }); },
    );

    coalescer.append("Pending text");
    coalescer.end();

    expect(flushes.length).toBe(1);
    expect(flushes[0].text).toBe("Pending text");
  });
});
