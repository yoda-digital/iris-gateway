import { describe, it, expect } from "vitest";
import { metrics } from "../../src/gateway/metrics.js";

describe("Prometheus Metrics", () => {
  it("exports metrics instance", () => {
    expect(metrics).toBeDefined();
  });

  it("has registry", () => {
    expect(metrics.getRegistry()).toBeDefined();
  });

  it("has message counters", () => {
    expect(metrics.messagesReceived).toBeDefined();
    expect(metrics.messagesSent).toBeDefined();
    expect(metrics.messagesErrors).toBeDefined();
  });

  it("has latency histograms", () => {
    expect(metrics.messageProcessingLatency).toBeDefined();
    expect(metrics.intelligencePipelineLatency).toBeDefined();
  });

  it("has gauge metrics", () => {
    expect(metrics.activeConnections).toBeDefined();
    expect(metrics.queueDepth).toBeDefined();
    expect(metrics.systemHealth).toBeDefined();
    expect(metrics.uptime).toBeDefined();
  });

  it("has intelligence counters", () => {
    expect(metrics.arcsDetected).toBeDefined();
    expect(metrics.outcomesLogged).toBeDefined();
    expect(metrics.intentsTriggered).toBeDefined();
  });

  it("can increment message received counter", () => {
    expect(() => {
      metrics.messagesReceived.inc({ channel: "test" });
    }).not.toThrow();
  });

  it("can increment message sent counter", () => {
    expect(() => {
      metrics.messagesSent.inc({ channel: "test" });
    }).not.toThrow();
  });

  it("can increment error counter", () => {
    expect(() => {
      metrics.messagesErrors.inc({ channel: "test", error_type: "timeout" });
    }).not.toThrow();
  });

  it("can observe latency", () => {
    expect(() => {
      metrics.messageProcessingLatency.observe({ channel: "test", stage: "parse" }, 0.1);
    }).not.toThrow();
  });

  it("can set gauge values", () => {
    expect(() => {
      metrics.activeConnections.set({ channel: "test" }, 5);
    }).not.toThrow();
  });

  it("can export metrics as text", async () => {
    const text = await metrics.metrics();
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("includes Node.js version metrics", async () => {
    const text = await metrics.metrics();
    expect(text).toContain("nodejs");
  });

  it("provides registry for Prometheus", () => {
    const registry = metrics.getRegistry();
    expect(typeof registry.metrics).toBe("function");
  });
});
