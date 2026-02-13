import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamCoalescer } from "../../src/bridge/stream-coalescer.js";

describe("StreamCoalescer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("flushes when buffer exceeds maxChars", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 10, maxChars: 50, idleMs: 1000, breakOn: "word", editInPlace: false }, onFlush);
    c.append("x".repeat(60));
    expect(onFlush).toHaveBeenCalled();
    expect(onFlush.mock.calls[0][0].length).toBeLessThanOrEqual(50);
  });

  it("flushes on idle timer when buffer >= minChars", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 5, maxChars: 1000, idleMs: 500, breakOn: "word", editInPlace: false }, onFlush);
    c.append("Hello world");
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onFlush).toHaveBeenCalledWith("Hello world", false);
  });

  it("does not flush on idle when buffer < minChars", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 100, maxChars: 1000, idleMs: 500, breakOn: "word", editInPlace: false }, onFlush);
    c.append("Hi");
    vi.advanceTimersByTime(500);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("end() flushes remaining buffer regardless of minChars", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 100, maxChars: 1000, idleMs: 500, breakOn: "word", editInPlace: false }, onFlush);
    c.append("Short");
    c.end();
    expect(onFlush).toHaveBeenCalledWith("Short", false);
  });

  it("breaks on paragraph boundary", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 5, maxChars: 30, idleMs: 5000, breakOn: "paragraph", editInPlace: false }, onFlush);
    c.append("First paragraph.\n\nSecond paragraph that is longer.");
    expect(onFlush).toHaveBeenCalled();
  });

  it("passes isEdit=true when editInPlace is enabled and not first flush", () => {
    const onFlush = vi.fn();
    const c = new StreamCoalescer({ enabled: true, minChars: 5, maxChars: 20, idleMs: 5000, breakOn: "word", editInPlace: true }, onFlush);
    c.append("First chunk is here.");
    expect(onFlush).toHaveBeenCalledWith(expect.any(String), false);
    onFlush.mockClear();
    c.append("Second chunk is here too.");
    expect(onFlush).toHaveBeenCalledWith(expect.any(String), true);
  });
});
