import { describe, it, expect, vi, beforeEach } from "vitest";
import { CanvasServer } from "../../src/canvas/server.js";
import type { Logger } from "../../src/logging/logger.js";

describe("CanvasServer", () => {
  let mockLogger: Logger;
  let server: CanvasServer;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    server = new CanvasServer({
      port: 19878,
      hostname: "localhost",
      logger: mockLogger,
      onMessage: vi.fn(),
    });
  });

  describe("getSession", () => {
    it("creates new session if not exists", () => {
      const session = server.getSession("test-1");
      expect(session).toBeDefined();
      expect(session.getComponents()).toHaveLength(0);
    });

    it("returns existing session on subsequent calls", () => {
      const session1 = server.getSession("test-2");
      session1.addComponent({ type: "text", id: "t1", content: "Hello" });

      const session2 = server.getSession("test-2");
      expect(session2).toBe(session1);
      expect(session2.getComponents()).toHaveLength(1);
    });

    it("maintains separate sessions for different IDs", () => {
      const sessionA = server.getSession("session-a");
      const sessionB = server.getSession("session-b");

      sessionA.addComponent({ type: "text", id: "a1", content: "A" });
      sessionB.addComponent({ type: "text", id: "b1", content: "B" });

      expect(sessionA.getComponents()).toHaveLength(1);
      expect(sessionB.getComponents()).toHaveLength(1);
      expect(sessionA.getComponents()[0].id).toBe("a1");
      expect(sessionB.getComponents()[0].id).toBe("b1");
    });
  });

  describe("updateComponent", () => {
    it("adds component to session", () => {
      server.updateComponent("test-3", { type: "text", id: "t1", content: "Hello" });
      const session = server.getSession("test-3");
      expect(session.getComponents()).toHaveLength(1);
    });

    it("updates existing component", () => {
      server.updateComponent("test-4", { type: "text", id: "t1", content: "First" });
      server.updateComponent("test-4", { type: "text", id: "t1", content: "Updated" });
      const session = server.getSession("test-4");
      expect(session.getComponents()).toHaveLength(1);
      expect((session.getComponents()[0] as any).content).toBe("Updated");
    });

    it("creates session if not exists", () => {
      server.updateComponent("new-session", { type: "markdown", id: "m1", content: "# Title" });
      const session = server.getSession("new-session");
      expect(session.getComponents()).toHaveLength(1);
    });

    it("handles different component types", () => {
      server.updateComponent("test-5", { type: "text", id: "t1", content: "Text" });
      server.updateComponent("test-5", { type: "markdown", id: "m1", content: "# MD" });
      server.updateComponent("test-5", {
        type: "table",
        id: "tbl1",
        headers: ["A", "B"],
        rows: [["1", "2"]],
      });

      const session = server.getSession("test-5");
      expect(session.getComponents()).toHaveLength(3);
    });
  });

  describe("addAssistantMessage", () => {
    it("adds message to session", () => {
      server.addAssistantMessage("test-6", "Hello from assistant");
      const session = server.getSession("test-6");
      expect(session.getMessages()).toHaveLength(1);
      expect(session.getMessages()[0].role).toBe("assistant");
      expect(session.getMessages()[0].text).toBe("Hello from assistant");
    });

    it("adds message with timestamp", () => {
      const before = Date.now();
      server.addAssistantMessage("test-7", "Message");
      const after = Date.now();

      const session = server.getSession("test-7");
      const msg = session.getMessages()[0];
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it("creates session if not exists", () => {
      server.addAssistantMessage("new-session-2", "Test message");
      const session = server.getSession("new-session-2");
      expect(session.getMessages()).toHaveLength(1);
    });

    it("allows multiple messages", () => {
      server.addAssistantMessage("test-8", "First");
      server.addAssistantMessage("test-8", "Second");
      server.addAssistantMessage("test-8", "Third");

      const session = server.getSession("test-8");
      expect(session.getMessages()).toHaveLength(3);
      expect(session.getMessages().map((m) => m.text)).toEqual(["First", "Second", "Third"]);
    });
  });

  describe("start and stop", () => {
    it("has start method", () => {
      expect(typeof (server as any).start).toBe("function");
    });

    it("has stop method", () => {
      expect(typeof (server as any).stop).toBe("function");
    });
  });
});
