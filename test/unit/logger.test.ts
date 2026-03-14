import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLogger } from "../../src/logging/logger.js";

describe("createLogger", () => {
  let tempDir: string | undefined;
  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

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

  it("creates a pretty logger when json is false", () => {
    const logger = createLogger({ level: "info", json: false });
    expect(logger).toBeDefined();
    expect(logger.level).toBe("info");
  });

  it("writes to a file when config.file is set", () => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-logger-test-"));
    const filePath = join(tempDir, "out.log");
    const logger = createLogger({ level: "info", json: true, file: filePath });
    expect(logger).toBeDefined();
    expect(logger.level).toBe("info");
    logger.info("test log entry");
    // Pino uses streams — flush synchronously via the destination
    (logger as unknown as { flush?: () => void }).flush?.();
    // File is created by pino.destination on first write or at creation
    expect(existsSync(filePath)).toBe(true);
  });
});
