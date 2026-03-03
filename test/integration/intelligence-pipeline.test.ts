import { describe, it, expect, beforeEach, vi } from "vitest";
import { IntelligenceBus } from "../../src/intelligence/bus.js";

describe("Intelligence Pipeline - Full Message Processing", () => {
  let bus: IntelligenceBus;

  beforeEach(() => {
    bus = new IntelligenceBus();
  });

  it("processes full message with intelligence context", () => {
    const eventHandler = vi.fn();
    bus.on("arc_created", eventHandler);

    // Simulate message triggering arc creation
    const arcEvent = {
      type: "arc_created" as const,
      arcId: "arc-msg-001",
      patterns: [
        { type: "temporal" as const, span: 86400000 },
        { type: "emotional" as const, sentiment: 0.8 },
      ],
    };

    bus.emit(arcEvent);

    expect(eventHandler).toHaveBeenCalledWith(arcEvent);
    expect(eventHandler).toHaveBeenCalledTimes(1);
  });

  it("chains multiple intelligence events for single message", () => {
    const arcHandler = vi.fn();
    const outcomeHandler = vi.fn();

    bus.on("arc_created", arcHandler);
    bus.on("outcome_logged", outcomeHandler);

    // Message -> arc creation
    const arcEvent = {
      type: "arc_created" as const,
      arcId: "arc-msg-002",
      patterns: [],
    };
    bus.emit(arcEvent);

    // Message -> outcome recording
    const outcomeEvent = {
      type: "outcome_logged" as const,
      outcomeId: "out-msg-002",
      isPositive: true,
      value: 0.75,
      context: { messageId: "msg-002", arcId: "arc-msg-002" },
    };
    bus.emit(outcomeEvent);

    expect(arcHandler).toHaveBeenCalledTimes(1);
    expect(outcomeHandler).toHaveBeenCalledTimes(1);
  });

  it("integrates intent trigger -> arc -> outcome flow", () => {
    const events: any[] = [];
    
    bus.on("intent_triggered", (e) => events.push(e));
    bus.on("arc_created", (e) => events.push(e));
    bus.on("outcome_logged", (e) => events.push(e));

    // Step 1: Intent triggers
    const intentEvent = {
      type: "intent_triggered" as const,
      intentId: "intent-001",
      confidence: 0.92,
    };
    bus.emit(intentEvent);

    // Step 2: Intent creates arc
    const arcEvent = {
      type: "arc_created" as const,
      arcId: "arc-from-intent-001",
      patterns: [{ type: "behavioral" as const, score: 0.92 }],
    };
    bus.emit(arcEvent);

    // Step 3: Arc produces outcome
    const outcomeEvent = {
      type: "outcome_logged" as const,
      outcomeId: "out-from-arc-001",
      isPositive: true,
      value: 0.88,
      context: { source: "intent", arcId: "arc-from-intent-001" },
    };
    bus.emit(outcomeEvent);

    expect(events.length).toBe(3);
    expect(events[0].type).toBe("intent_triggered");
    expect(events[1].type).toBe("arc_created");
    expect(events[2].type).toBe("outcome_logged");
  });

  it("handles concurrent intelligence events", () => {
    const eventLog: string[] = [];
    
    bus.on("arc_created", () => eventLog.push("arc"));
    bus.on("outcome_logged", () => eventLog.push("outcome"));
    bus.on("trigger_evaluated", () => eventLog.push("trigger"));

    // Fire events in rapid succession (simulating high-load scenario)
    for (let i = 0; i < 3; i++) {
      bus.emit({
        type: "arc_created" as const,
        arcId: `arc-${i}`,
        patterns: [],
      });
    }

    for (let i = 0; i < 3; i++) {
      bus.emit({
        type: "outcome_logged" as const,
        outcomeId: `out-${i}`,
        isPositive: true,
        value: 0.8,
        context: {},
      });
    }

    for (let i = 0; i < 2; i++) {
      bus.emit({
        type: "trigger_evaluated" as const,
        triggerId: `trig-${i}`,
        matched: true,
      });
    }

    expect(eventLog).toEqual([
      "arc", "arc", "arc",
      "outcome", "outcome", "outcome",
      "trigger", "trigger",
    ]);
  });

  it("provides message context across intelligence layer", () => {
    const contextData = {
      messageId: "msg-123",
      senderId: "user-456",
      channel: "telegram",
      content: "Test message with intelligence",
      timestamp: Date.now(),
    };

    const arcHandler = vi.fn();
    const outcomeHandler = vi.fn();

    bus.on("arc_created", arcHandler);
    bus.on("outcome_logged", outcomeHandler);

    // Arc with message context
    const arcEvent = {
      type: "arc_created" as const,
      arcId: `arc-${contextData.messageId}`,
      patterns: [
        { type: "textual" as const, entropy: 0.65 },
        { type: "channel" as const, channelId: contextData.channel },
      ],
    };
    bus.emit(arcEvent);

    // Outcome with full context
    const outcomeEvent = {
      type: "outcome_logged" as const,
      outcomeId: `out-${contextData.messageId}`,
      isPositive: true,
      value: 0.72,
      context: contextData,
    };
    bus.emit(outcomeEvent);

    expect(arcHandler).toHaveBeenCalled();
    expect(outcomeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeId: `out-${contextData.messageId}`,
        context: expect.objectContaining(contextData),
      })
    );
  });

  it("maintains event order in high-load intelligence scenario", () => {
    const receivedEvents: string[] = [];

    bus.on("arc_created", (e) => receivedEvents.push(`arc:${e.arcId}`));
    bus.on("trigger_evaluated", (e) => receivedEvents.push(`trig:${e.triggerId}`));
    bus.on("outcome_logged", (e) => receivedEvents.push(`out:${e.outcomeId}`));

    // Send in strict order
    bus.emit({
      type: "arc_created" as const,
      arcId: "arc-1",
      patterns: [],
    });
    bus.emit({
      type: "trigger_evaluated" as const,
      triggerId: "trig-1",
      matched: true,
    });
    bus.emit({
      type: "outcome_logged" as const,
      outcomeId: "out-1",
      isPositive: true,
      value: 0.8,
      context: {},
    });
    bus.emit({
      type: "arc_created" as const,
      arcId: "arc-2",
      patterns: [],
    });
    bus.emit({
      type: "trigger_evaluated" as const,
      triggerId: "trig-2",
      matched: false,
    });
    bus.emit({
      type: "outcome_logged" as const,
      outcomeId: "out-2",
      isPositive: false,
      value: 0.3,
      context: {},
    });

    expect(receivedEvents).toEqual([
      "arc:arc-1",
      "trig:trig-1",
      "out:out-1",
      "arc:arc-2",
      "trig:trig-2",
      "out:out-2",
    ]);
  });
});
