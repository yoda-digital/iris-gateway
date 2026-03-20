import { describe, it, expect, vi, beforeEach } from "vitest";
import { CanvasServer } from "../../src/canvas/server.js";
import type { Logger } from "../../src/logging/logger.js";
import type { TextComponent } from "../../src/canvas/components.js";

// Hoist mock vars so they're available in the vi.mock() factory (which is hoisted before imports)
const { mockServe, mockFakeServer } = vi.hoisted(() => {
  const mockFakeServer = { close: vi.fn() };
  return { mockFakeServer, mockServe: vi.fn().mockReturnValue(mockFakeServer) };
});

// Mock @hono/node-server so start() never binds a real port in unit tests
vi.mock("@hono/node-server", () => ({ serve: mockServe }));

describe("CanvasServer", () => {
  let mockLogger: Logger;
  let server: CanvasServer;

  beforeEach(() => {
    mockServe.mockClear();
    mockFakeServer.close.mockClear();

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
      expect((session.getComponents()[0] as TextComponent).content).toBe("Updated");
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

  describe("stop", () => {
    it("is a no-op when server has not been started", async () => {
      // server is freshly constructed in beforeEach — stop() should resolve cleanly
      await expect(server.stop()).resolves.toBeUndefined();
      // logger.info("Canvas server stopped") must NOT be called when nothing is running
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        "Canvas server stopped",
      );
    });

    it("logs and nullifies server on stop after start", async () => {
      // Inject a fake server object to simulate a running state without binding a real port
      const fakeClose = vi.fn();
      (server as unknown as { server: { close: () => void } | null }).server = {
        close: fakeClose,
      };

      await server.stop();

      expect(fakeClose).toHaveBeenCalledOnce();
      expect(mockLogger.info).toHaveBeenCalledWith("Canvas server stopped");
      // Internal server ref must be null after stop
      expect(
        (server as unknown as { server: unknown }).server,
      ).toBeNull();
    });
  });

  describe("start", () => {
    it("calls serve with correct config and logs 'Canvas server started'", async () => {
      // Bypass injectWebSocket — avoid calling the real ws upgrade with a fake server object
      (server as unknown as { wsUpgrade: unknown }).wsUpgrade = null;

      await server.start();

      expect(mockServe).toHaveBeenCalledWith(
        expect.objectContaining({ port: 19878, hostname: "localhost" }),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        { port: 19878 },
        "Canvas server started",
      );
    });

    it("wsUpgrade is set after construction", () => {
      // wsUpgrade is set during setupRoutes() inside constructor
      const wsUpgrade = (server as unknown as { wsUpgrade: unknown }).wsUpgrade;
      expect(wsUpgrade).not.toBeNull();
      expect(typeof wsUpgrade).toBe("function");
    });
  });

  describe("HTTP REST endpoints via app.request", () => {
    // Access private Hono app — no live port needed
    const getApp = (s: CanvasServer) =>
      (s as unknown as { app: import("hono").Hono }).app;

    it("POST /api/message adds assistant message to named session", async () => {
      const app = getApp(server);
      const res = await app.request("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "rest-1", text: "Hello via API" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
      const session = server.getSession("rest-1");
      expect(session.getMessages()).toHaveLength(1);
      expect(session.getMessages()[0].text).toBe("Hello via API");
    });

    it("POST /api/message uses default session when no sessionId provided", async () => {
      const app = getApp(server);
      const res = await app.request("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "No session" }),
      });
      expect(res.status).toBe(200);
      const session = server.getSession("default");
      expect(session.getMessages()).toHaveLength(1);
    });

    it("GET /api/sessions returns all registered sessions", async () => {
      server.getSession("list-1");
      server.getSession("list-2");
      const app = getApp(server);
      const res = await app.request("/api/sessions");
      expect(res.status).toBe(200);
      const body = await res.json() as { sessions: { id: string }[] };
      const ids = body.sessions.map((s) => s.id);
      expect(ids).toContain("list-1");
      expect(ids).toContain("list-2");
    });

    it("POST /api/canvas/update adds a component to the session", async () => {
      const app = getApp(server);
      const res = await app.request("/api/canvas/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "upd-1",
          component: { type: "text", id: "c1", content: "Injected" },
        }),
      });
      expect(res.status).toBe(200);
      expect(server.getSession("upd-1").getComponents()).toHaveLength(1);
    });

    it("POST /api/canvas/update clears all components when clear=true", async () => {
      server.updateComponent("upd-2", { type: "text", id: "c1", content: "A" });
      server.updateComponent("upd-2", { type: "text", id: "c2", content: "B" });
      const app = getApp(server);
      const res = await app.request("/api/canvas/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "upd-2", clear: true }),
      });
      expect(res.status).toBe(200);
      expect(server.getSession("upd-2").getComponents()).toHaveLength(0);
    });

    it("POST /api/canvas/update removes a specific component by id", async () => {
      server.updateComponent("upd-3", { type: "text", id: "keep", content: "Keep" });
      server.updateComponent("upd-3", { type: "text", id: "remove-me", content: "Remove" });
      const app = getApp(server);
      const res = await app.request("/api/canvas/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "upd-3", remove: "remove-me" }),
      });
      expect(res.status).toBe(200);
      const comps = server.getSession("upd-3").getComponents();
      expect(comps).toHaveLength(1);
      expect(comps[0].id).toBe("keep");
    });

    it("POST /api/canvas/update defaults to 'default' session when no sessionId", async () => {
      const app = getApp(server);
      const res = await app.request("/api/canvas/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ component: { type: "text", id: "d1", content: "Default" } }),
      });
      expect(res.status).toBe(200);
      expect(server.getSession("default").getComponents()).toHaveLength(1);
    });
  });
});
