import { describe, it, expect } from "vitest";
import { createLogger } from "../../src/logging/logger.js";

describe("createLogger", () => {
  it("creates a logger with default level", () => {
    const logger = createLogger();
    expect(logger).toBeDefined();
    expect(logger.level).toBe("info");
  });

  it("creates a logger with custom level", () => {
    const logger = createLogger({ level: "debug" });
    expect(logger.level).toBe("debug");
  });

  it("creates a logger with warn level", () => {
    const logger = createLogger({ level: "warn" });
    expect(logger.level).toBe("warn");
  });

  it("creates a child logger", () => {
    const logger = createLogger({ level: "info", json: true });
    const child = logger.child({ channel: "telegram" });
    expect(child).toBeDefined();
    expect(child.level).toBe("info");
  });

  it("creates a JSON logger in production mode", () => {
    const logger = createLogger({ level: "info", json: true });
    expect(logger).toBeDefined();
  });
});
