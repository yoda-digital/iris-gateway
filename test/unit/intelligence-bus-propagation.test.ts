import { describe, it, expect, vi } from "vitest";
import { IntelligenceBus } from "../../src/intelligence/bus.js";

describe("IntelligenceBus - Event Propagation", () => {
  it("propagates events to all registered handlers", () => {
    const bus = new IntelligenceBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    bus.on("arc_created", handler1);
    bus.on("arc_created", handler2);
    bus.on("arc_created", handler3);

    const event = { type: "arc_created" as const, arcId: "arc-1", patterns: [] };
    bus.emit(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
    expect(handler3).toHaveBeenCalledWith(event);
  });

  it("propagates events with full context to handlers", () => {
    const bus = new IntelligenceBus();
    const handler = vi.fn();

    bus.on("outcome_logged", handler);

    const event = {
      type: "outcome_logged" as const,
      outcomeId: "out-1",
      isPositive: true,
      value: 0.85,
      context: { source: "test" },
    };
    bus.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
    expect(handler.mock.calls[0][0].outcomeId).toBe("out-1");
    expect(handler.mock.calls[0][0].isPositive).toBe(true);
  });

  it("allows handlers to be unsubscribed", () => {
    const bus = new IntelligenceBus();
    const handler = vi.fn();

    bus.on("health_changed", handler);
    const event = {
      type: "health_changed" as const,
      component: "health_gate",
      status: "normal" as const,
    };

    bus.emit(event);
    expect(handler).toHaveBeenCalledTimes(1);

    bus.off("health_changed", handler);
    bus.emit(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("propagates different event types independently", () => {
    const bus = new IntelligenceBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on("arc_created", handler1);
    bus.on("outcome_logged", handler2);

    const arcEvent = { type: "arc_created" as const, arcId: "arc-1", patterns: [] };
    const outcomeEvent = {
      type: "outcome_logged" as const,
      outcomeId: "out-1",
      isPositive: true,
      value: 0.8,
      context: {},
    };

    bus.emit(arcEvent);
    bus.emit(outcomeEvent);

    expect(handler1).toHaveBeenCalledWith(arcEvent);
    expect(handler2).toHaveBeenCalledWith(outcomeEvent);
  });

  it("maintains handler order", () => {
    const bus = new IntelligenceBus();
    const order: number[] = [];

    bus.on("intent_triggered", () => { order.push(1); });
    bus.on("intent_triggered", () => { order.push(2); });
    bus.on("intent_triggered", () => { order.push(3); });

    const event = {
      type: "intent_triggered" as const,
      intentId: "intent-1",
      confidence: 0.9,
    };
    bus.emit(event);

    expect(order).toEqual([1, 2, 3]);
  });

  it("handles multiple event emissions correctly", () => {
    const bus = new IntelligenceBus();
    const handler = vi.fn();

    bus.on("trigger_evaluated", handler);

    const event1 = {
      type: "trigger_evaluated" as const,
      triggerId: "trig-1",
      matched: true,
    };
    const event2 = {
      type: "trigger_evaluated" as const,
      triggerId: "trig-2",
      matched: false,
    };

    bus.emit(event1);
    bus.emit(event2);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].triggerId).toBe("trig-1");
    expect(handler.mock.calls[1][0].triggerId).toBe("trig-2");
  });

  it("disposes all listeners on dispose", () => {
    const bus = new IntelligenceBus();
    const handler = vi.fn();

    bus.on("arc_created", handler);

    const event = { type: "arc_created" as const, arcId: "arc-1", patterns: [] };
    bus.emit(event);
    expect(handler).toHaveBeenCalledTimes(1);

    bus.dispose();
    bus.emit(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
