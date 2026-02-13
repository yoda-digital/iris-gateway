import { describe, it, expect, vi } from "vitest";
import { CanvasSession } from "../../src/canvas/session.js";

describe("CanvasSession", () => {
  it("adds and retrieves components", () => {
    const session = new CanvasSession("test");
    session.addComponent({ type: "text", id: "t1", content: "Hello" });
    expect(session.getComponents()).toHaveLength(1);
    expect(session.getComponents()[0].id).toBe("t1");
  });

  it("updates existing component by id", () => {
    const session = new CanvasSession("test");
    session.addComponent({ type: "text", id: "t1", content: "Hello" });
    session.addComponent({ type: "text", id: "t1", content: "Updated" });
    expect(session.getComponents()).toHaveLength(1);
    expect((session.getComponents()[0] as any).content).toBe("Updated");
  });

  it("removes component by id", () => {
    const session = new CanvasSession("test");
    session.addComponent({ type: "text", id: "t1", content: "Hello" });
    expect(session.removeComponent("t1")).toBe(true);
    expect(session.getComponents()).toHaveLength(0);
    expect(session.removeComponent("t1")).toBe(false);
  });

  it("clears all components", () => {
    const session = new CanvasSession("test");
    session.addComponent({ type: "text", id: "t1", content: "A" });
    session.addComponent({ type: "text", id: "t2", content: "B" });
    session.clearComponents();
    expect(session.getComponents()).toHaveLength(0);
  });

  it("adds and retrieves messages", () => {
    const session = new CanvasSession("test");
    session.addMessage({ role: "user", text: "Hi", timestamp: Date.now() });
    expect(session.getMessages()).toHaveLength(1);
  });

  it("broadcasts to connected clients", () => {
    const session = new CanvasSession("test");
    const received: string[] = [];
    const unsub = session.addClient((data) => received.push(data));

    // Should have received initial state
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]).type).toBe("state");

    session.addComponent({ type: "text", id: "t1", content: "Hello" });
    expect(received).toHaveLength(2);
    expect(JSON.parse(received[1]).type).toBe("component.update");

    unsub();
    session.addComponent({ type: "text", id: "t2", content: "World" });
    expect(received).toHaveLength(2); // No more broadcasts after unsub
  });
});
