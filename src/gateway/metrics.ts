import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Prometheus metrics registry for iris-gateway.
 * Tracks message throughput, latency, errors, and system health.
 */
class MetricsRegistry {
  private readonly registry = new Registry();

  // Message counters
  readonly messagesReceived = new Counter({
    name: "iris_messages_received_total",
    help: "Total number of messages received",
    labelNames: ["channel"],
    registers: [this.registry],
  });

  readonly messagesSent = new Counter({
    name: "iris_messages_sent_total",
    help: "Total messages sent per channel",
    labelNames: ["channel"],
    registers: [this.registry],
  });

  readonly messagesErrors = new Counter({
    name: "iris_messages_errors_total",
    help: "Total number of message processing errors",
    labelNames: ["channel", "error_type"],
    registers: [this.registry],
  });

  // Latency histograms
  readonly messageProcessingLatency = new Histogram({
    name: "iris_message_processing_seconds",
    help: "Message processing latency in seconds",
    labelNames: ["channel", "stage"],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [this.registry],
  });

  readonly intelligencePipelineLatency = new Histogram({
    name: "iris_intelligence_pipeline_seconds",
    help: "Intelligence pipeline processing latency in seconds",
    labelNames: ["stage"],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
    registers: [this.registry],
  });

  // Gauge metrics
  readonly activeConnections = new Gauge({
    name: "iris_active_connections",
    help: "Number of active channel connections",
    labelNames: ["channel"],
    registers: [this.registry],
  });

  readonly queueDepth = new Gauge({
    name: "iris_queue_depth",
    help: "Current depth of the message queue",
    registers: [this.registry],
  });

  readonly systemHealth = new Gauge({
    name: "iris_system_health",
    help: "System health status (1=healthy, 0.5=degraded, 0=unhealthy)",
    labelNames: ["component"],
    registers: [this.registry],
  });

  readonly uptime = new Gauge({
    name: "iris_uptime_seconds",
    help: "System uptime in seconds",
    registers: [this.registry],
  });

  // Intelligence metrics
  readonly arcsDetected = new Counter({
    name: "iris_arcs_detected_total",
    help: "Total number of detected behavioral arcs",
    registers: [this.registry],
  });

  readonly outcomesLogged = new Counter({
    name: "iris_outcomes_logged_total",
    help: "Total number of logged outcomes",
    labelNames: ["type"],
    registers: [this.registry],
  });

  readonly intentsTriggered = new Counter({
    name: "iris_intents_triggered_total",
    help: "Total number of triggered intents",
    labelNames: ["intent_id"],
    registers: [this.registry],
  });

  constructor() {
    // Collect default Node.js metrics (memory, CPU, etc.)
    collectDefaultMetrics({ register: this.registry });
  }

  getRegistry(): Registry {
    return this.registry;
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  async metricsAsJson(): Promise<unknown> {
    return this.registry.getMetricsAsJSON();
  }
}

// Singleton instance
export const metrics = new MetricsRegistry();
