import { describe, it, expect, vi } from "vitest";
import { HookBus } from "../../src/plugins/hook-bus.js";

describe("HookBus", () => {
  it("calls handlers in registration order", async () => {
    const bus = new HookBus();
    const order: number[] = [];
    bus.on("gateway.ready", () => { order.push(1); });
    bus.on("gateway.ready", () => { order.push(2); });
    await bus.emit("gateway.ready", undefined as never);
    expect(order).toEqual([1, 2]);
  });

  it("passes data to handlers", async () => {
    const bus = new HookBus();
    const handler = vi.fn();
    bus.on("message.outbound", handler);
    await bus.emit("message.outbound", { channelId: "tg", chatId: "1", text: "hi" });
    expect(handler).toHaveBeenCalledWith({ channelId: "tg", chatId: "1", text: "hi" });
  });

  it("continues on handler error", async () => {
    const bus = new HookBus();
    const handler2 = vi.fn();
    bus.on("gateway.ready", () => { throw new Error("boom"); });
    bus.on("gateway.ready", handler2);
    await bus.emit("gateway.ready", undefined as never);
    expect(handler2).toHaveBeenCalled();
  });

  it("supports removing handlers", async () => {
    const bus = new HookBus();
    const handler = vi.fn();
    const unsub = bus.on("gateway.ready", handler);
    unsub();
    await bus.emit("gateway.ready", undefined as never);
    expect(handler).not.toHaveBeenCalled();
  });
});
