import { describe, it, expect } from "vitest";
import { renderCanvasHTML } from "../../src/canvas/renderer.js";

describe("renderCanvasHTML", () => {
  it("returns valid HTML string", () => {
    const html = renderCanvasHTML("test-session", "ws://localhost:8080/ws");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("includes sessionId in script", () => {
    const sessionId = "my-session-123";
    const html = renderCanvasHTML(sessionId, "ws://localhost:8080/ws");
    expect(html).toContain(JSON.stringify(sessionId));
  });

  it("includes wsUrl in script", () => {
    const wsUrl = "ws://example.com:9000/socket";
    const html = renderCanvasHTML("test", wsUrl);
    expect(html).toContain(JSON.stringify(wsUrl));
  });

  it("includes required CDN scripts", () => {
    const html = renderCanvasHTML("test", "ws://localhost/ws");
    expect(html).toContain("chart.js");
    expect(html).toContain("marked");
  });

  it("includes Canvas title", () => {
    const html = renderCanvasHTML("test", "ws://localhost/ws");
    expect(html).toContain("Iris Canvas");
  });

  it("includes connection status element", () => {
    const html = renderCanvasHTML("test", "ws://localhost/ws");
    expect(html).toContain('id="status"');
    expect(html).toContain("Disconnected");
  });

  it("includes message input and send button", () => {
    const html = renderCanvasHTML("test", "ws://localhost/ws");
    expect(html).toContain('id="msg-input"');
    expect(html).toContain('onclick="sendMessage()"');
  });

  it("includes components container", () => {
    const html = renderCanvasHTML("test", "ws://localhost/ws");
    expect(html).toContain('id="components"');
  });

  it("includes WebSocket connection script", () => {
    const html = renderCanvasHTML("test", "ws://localhost/ws");
    expect(html).toContain("new WebSocket");
    expect(html).toContain("ws.onopen");
    expect(html).toContain("ws.onmessage");
  });

  it("properly escapes sessionId special characters", () => {
    const sessionId = 'test"session';
    const html = renderCanvasHTML(sessionId, "ws://localhost/ws");
    // JSON.stringify should escape the quotes — verify the full escaped value appears in output
    expect(html).toContain(JSON.stringify(sessionId));
  });

  it("properly escapes wsUrl special characters", () => {
    const wsUrl = 'ws://localhost/ws?token=abc"123';
    const html = renderCanvasHTML("test", wsUrl);
    expect(html).toContain(JSON.stringify(wsUrl));
    expect(html).toContain('\\"');
  });
});
