import { describe, it, expect, vi } from "vitest";
import { TypedEventEmitter } from "../../src/utils/typed-emitter.js";

interface TestEvents {
  data: (value: string) => void;
  count: (n: number) => void;
  empty: () => void;
}

describe("TypedEventEmitter", () => {
  it("emits and receives events with correct types", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on("data", handler);
    emitter.emit("data", "hello");
    expect(handler).toHaveBeenCalledWith("hello");
  });

  it("supports once listeners", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.once("data", handler);
    emitter.emit("data", "first");
    emitter.emit("data", "second");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("first");
  });

  it("removes listeners with off", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on("data", handler);
    emitter.off("data", handler);
    emitter.emit("data", "ignored");
    expect(handler).not.toHaveBeenCalled();
  });

  it("removes all listeners", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    emitter.on("data", vi.fn());
    emitter.on("data", vi.fn());
    expect(emitter.listenerCount("data")).toBe(2);
    emitter.removeAllListeners("data");
    expect(emitter.listenerCount("data")).toBe(0);
  });

  it("handles events with no arguments", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on("empty", handler);
    emitter.emit("empty");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("handles number arguments", () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const handler = vi.fn();
    emitter.on("count", handler);
    emitter.emit("count", 42);
    expect(handler).toHaveBeenCalledWith(42);
  });
});
