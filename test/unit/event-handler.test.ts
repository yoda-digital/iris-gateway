import { describe, it, expect, vi, afterEach } from "vitest";
import { EventHandler } from "../../src/bridge/event-handler.js";
import type { OpenCodeEvent } from "../../src/bridge/opencode-client.js";

function makeEvent(type: string, properties: Record<string, unknown>): OpenCodeEvent {
  return { type, properties } as unknown as OpenCodeEvent;
}

describe("EventHandler", () => {
  let handler: EventHandler;

  afterEach(() => {
    handler?.dispose();
  });

  it("accumulates text parts and emits on session.idle", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "Hello", sessionID: "s1" },
        delta: "Hello",
      }),
    );
    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "Hello world", sessionID: "s1" },
        delta: " world",
      }),
    );

    // Not emitted yet
    expect(onResponse).not.toHaveBeenCalled();

    // Trigger idle
    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));

    expect(onResponse).toHaveBeenCalledWith("s1", "Hello world");
  });

  it("replaces text when delta is absent", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "First", sessionID: "s1" },
        delta: "First",
      }),
    );
    // No delta — full replacement
    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "Replaced", sessionID: "s1" },
      }),
    );

    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).toHaveBeenCalledWith("s1", "Replaced");
  });

  it("emits toolCall for tool parts", () => {
    handler = new EventHandler();
    const onTool = vi.fn();
    handler.events.on("toolCall", onTool);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "tool", tool: "sendMessage", sessionID: "s1", metadata: { foo: 1 } },
      }),
    );

    expect(onTool).toHaveBeenCalledWith("s1", "sendMessage", { foo: 1 });
  });

  it("emits error on session.error and clears accumulator", () => {
    handler = new EventHandler();
    const onError = vi.fn();
    const onResponse = vi.fn();
    handler.events.on("error", onError);
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "partial", sessionID: "s1" },
        delta: "partial",
      }),
    );

    handler.handleEvent(
      makeEvent("session.error", { sessionID: "s1", error: "something broke" }),
    );

    expect(onError).toHaveBeenCalledWith("s1", "something broke");

    // Subsequent idle should not emit response (accumulator cleared)
    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).not.toHaveBeenCalled();
  });

  it("ignores events without type", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent({} as OpenCodeEvent);
    handler.handleEvent({ properties: {} } as unknown as OpenCodeEvent);

    expect(onResponse).not.toHaveBeenCalled();
  });

  it("ignores events without properties", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent({ type: "session.idle" } as unknown as OpenCodeEvent);

    expect(onResponse).not.toHaveBeenCalled();
  });

  it("handles multiple sessions independently", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "A", sessionID: "s1" },
        delta: "A",
      }),
    );
    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "B", sessionID: "s2" },
        delta: "B",
      }),
    );

    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).toHaveBeenCalledWith("s1", "A");
    expect(onResponse).not.toHaveBeenCalledWith("s2", expect.anything());

    handler.handleEvent(makeEvent("session.idle", { sessionID: "s2" }));
    expect(onResponse).toHaveBeenCalledWith("s2", "B");
  });

  it("does not emit response if no text accumulated", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).not.toHaveBeenCalled();
  });

  it("falls back to reasoning text when no text parts exist", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "reasoning", text: "Let me think...", sessionID: "s1" },
      }),
    );

    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).toHaveBeenCalledWith("s1", "Let me think...");
  });

  it("prefers text parts over reasoning parts", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "reasoning", text: "thinking...", sessionID: "s1" },
      }),
    );
    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "Hello!", sessionID: "s1" },
      }),
    );

    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).toHaveBeenCalledWith("s1", "Hello!");
  });

  it("type guard rejects invalid text parts", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    // Missing sessionID
    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "hello" },
      }),
    );

    // Missing text
    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", sessionID: "s1" },
      }),
    );

    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).not.toHaveBeenCalled();
  });

  it("dispose clears timer and accumulator", () => {
    handler = new EventHandler();

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "partial", sessionID: "s1" },
        delta: "partial",
      }),
    );

    handler.dispose();

    const onResponse = vi.fn();
    handler.events.on("response", onResponse);
    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // markDelivered() and delivered-guard tests (added by PR #289 fix iteration)
  // ──────────────────────────────────────────────────────────────────────────

  it("markDelivered() sets delivered=true and prevents a subsequent session.idle from emitting", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "Hello", sessionID: "s1" },
        delta: "Hello",
      }),
    );

    // Polling path wins — mark delivered before SSE fires
    handler.markDelivered("s1");

    // SSE session.idle fires after polling has already delivered
    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));

    // Should not double-emit
    expect(onResponse).not.toHaveBeenCalled();
  });

  it("delivered guard: second session.idle for the same session is silently dropped", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "Once", sessionID: "s1" },
        delta: "Once",
      }),
    );

    // First idle — SSE wins
    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(onResponse).toHaveBeenCalledWith("s1", "Once");

    // Second idle for the same session — accumulator was deleted, must not re-emit
    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it("SSE wins: session.idle fires before markDelivered — response emitted once, no double delivery", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "SSE first", sessionID: "s1" },
        delta: "SSE first",
      }),
    );

    // SSE path fires first
    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).toHaveBeenCalledOnce();
    expect(onResponse).toHaveBeenCalledWith("s1", "SSE first");

    // Polling path calls markDelivered afterwards — should be a no-op (entry already deleted)
    handler.markDelivered("s1");

    // No further emissions
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it("polling wins: markDelivered called before session.idle — response never emitted via SSE", () => {
    handler = new EventHandler();
    const onResponse = vi.fn();
    handler.events.on("response", onResponse);

    handler.handleEvent(
      makeEvent("message.part.updated", {
        part: { type: "text", text: "Polling first", sessionID: "s1" },
        delta: "Polling first",
      }),
    );

    // Polling path wins — marks delivered before SSE idle fires
    handler.markDelivered("s1");

    // SSE session.idle arrives late — must be silently dropped
    handler.handleEvent(makeEvent("session.idle", { sessionID: "s1" }));
    expect(onResponse).not.toHaveBeenCalled();
  });

  it("emits permissionRequest for a well-formed permission.updated payload", () => {
    handler = new EventHandler();
    const onPerm = vi.fn();
    handler.events.on("permissionRequest", onPerm);

    handler.handleEvent(
      makeEvent("permission.updated", {
        id: "perm-1",
        sessionID: "s1",
        type: "bash",
        title: "Bash access",
        messageID: "msg-1",
        metadata: {},
        time: { created: 0 },
      }),
    );

    expect(onPerm).toHaveBeenCalledOnce();
    expect(onPerm.mock.calls[0]![0]).toBe("s1");
    expect(onPerm.mock.calls[0]![1]).toMatchObject({ id: "perm-1", type: "bash", sessionID: "s1" });
  });

  it("ignores permission.updated payload missing id, sessionID, or type", () => {
    handler = new EventHandler();
    const onPerm = vi.fn();
    handler.events.on("permissionRequest", onPerm);

    // Missing id
    handler.handleEvent(makeEvent("permission.updated", { sessionID: "s1", type: "bash" }));
    // Missing sessionID
    handler.handleEvent(makeEvent("permission.updated", { id: "p1", type: "bash" }));
    // Missing type
    handler.handleEvent(makeEvent("permission.updated", { id: "p1", sessionID: "s1" }));
    // Empty object
    handler.handleEvent(makeEvent("permission.updated", {}));

    expect(onPerm).not.toHaveBeenCalled();
  });
});
