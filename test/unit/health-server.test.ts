import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version: pkgVersion } = require("../../package.json") as { version: string };
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HealthServer } from "../../src/gateway/health.js";

function mockRegistry() {
  return {
    list: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    has: vi.fn().mockReturnValue(false),
    register: vi.fn(),
  } as any;
}

function mockBridge() {
  return {
    checkHealth: vi.fn().mockResolvedValue(true),
  } as any;
}

const fakeAdapter = {
  id: "telegram",
  label: "Telegram",
  capabilities: {
    image: true,
    video: false,
    edit: true,
    delete: false,
    reaction: true,
  },
};

describe("HealthServer", () => {
  let server: HealthServer;
  let registry: ReturnType<typeof mockRegistry>;
  let bridge: ReturnType<typeof mockBridge>;
  let base: string;

  beforeEach(async () => {
    registry = mockRegistry();
    bridge = mockBridge();
    server = new HealthServer(registry, bridge, 0, "127.0.0.1");
    await server.start();
    const addr = server.address()!;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  describe("GET /health", () => {
    it("returns JSON with status, version, uptime, and system fields", async () => {
      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("version", pkgVersion);
      expect(body).toHaveProperty("uptime");
      expect(body).toHaveProperty("uptimeHuman");
      expect(body).toHaveProperty("system");
      expect(body.system).toHaveProperty("memoryMB");
      expect(body.system).toHaveProperty("nodeVersion");
      expect(body.system).toHaveProperty("platform");
      expect(body.system).toHaveProperty("pid");
    });

    it("returns degraded when no channels are connected", async () => {
      registry.list.mockReturnValue([]);

      const res = await fetch(`${base}/health`);
      const body = await res.json();

      expect(body.status).toBe("degraded");
    });

    it("returns ok when channels exist and opencode is healthy", async () => {
      registry.list.mockReturnValue([fakeAdapter]);
      bridge.checkHealth.mockResolvedValue(true);

      const res = await fetch(`${base}/health`);
      const body = await res.json();

      expect(body.status).toBe("ok");
      expect(body.opencode.healthy).toBe(true);
      expect(body.channels).toHaveLength(1);
      expect(body.channels[0].id).toBe("telegram");
    });
  });

  describe("GET /ready", () => {
    it("returns 503 when no channels are connected", async () => {
      registry.list.mockReturnValue([]);

      const res = await fetch(`${base}/ready`);
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.ready).toBe(false);
      expect(body.reason).toBe("no channels connected");
    });

    it("returns 503 when opencode is unhealthy", async () => {
      registry.list.mockReturnValue([fakeAdapter]);
      bridge.checkHealth.mockResolvedValue(false);

      const res = await fetch(`${base}/ready`);
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.ready).toBe(false);
      expect(body.reason).toBe("opencode not reachable");
    });

    it("returns 200 when channels exist and opencode is healthy", async () => {
      registry.list.mockReturnValue([fakeAdapter]);
      bridge.checkHealth.mockResolvedValue(true);

      const res = await fetch(`${base}/ready`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.ready).toBe(true);
      expect(body.channels).toBe(1);
    });
  });

  describe("GET /channels", () => {
    it("returns empty array initially", async () => {
      const res = await fetch(`${base}/channels`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.channels).toEqual([]);
    });

    it("returns channel info when adapters are registered", async () => {
      registry.list.mockReturnValue([fakeAdapter]);

      const res = await fetch(`${base}/channels`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.channels).toHaveLength(1);
      expect(body.channels[0]).toEqual({
        id: "telegram",
        label: "Telegram",
        capabilities: {
          media: true,
          edit: true,
          delete: false,
          reaction: true,
        },
      });
    });
  });

  describe("GET /metrics", () => {
    it("returns Prometheus text format with correct Content-Type", async () => {
      const res = await fetch(`${base}/metrics`);
      expect(res.status).toBe(200);

      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("text/plain");
      expect(contentType).toContain("version=0.0.4");

      const text = await res.text();
      expect(text).toContain("# HELP");
      expect(text).toContain("# TYPE");
    });

    it("includes iris_uptime_seconds from MetricsRegistry", async () => {
      const res = await fetch(`${base}/metrics`);
      const text = await res.text();

      expect(text).toContain("iris_uptime_seconds");
    });
  });
});
