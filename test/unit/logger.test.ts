import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import { createLogger } from "../../src/logging/logger.js";

describe("createLogger", () => {
  it("returns a pino logger instance with standard logging methods", () => {
    const logger = createLogger({ level: "info", json: true });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("creates a logger with default level info", () => {
    const logger = createLogger();
    expect(logger).toBeDefined();
    expect(logger.level).toBe("info");
  });

  it("respects config.level — debug", () => {
    const logger = createLogger({ level: "debug" });
    expect(logger.level).toBe("debug");
  });

  it("respects config.level — warn", () => {
    const logger = createLogger({ level: "warn" });
    expect(logger.level).toBe("warn");
  });

  it("respects config.level — error", () => {
    const logger = createLogger({ level: "error" });
    expect(logger.level).toBe("error");
  });

  it("uses pino-pretty transport when json=false (non-production)", () => {
    // json=false triggers pino-pretty; if pino-pretty is missing this throws
    const logger = createLogger({ level: "info", json: false });
    expect(logger).toBeDefined();
    expect(logger.level).toBe("info");
  });

  it("uses no special transport when json=true", () => {
    const logger = createLogger({ level: "info", json: true });
    expect(logger).toBeDefined();
    expect(logger.level).toBe("info");
  });

  it("creates a child logger that inherits level", () => {
    const logger = createLogger({ level: "info", json: true });
    const child = logger.child({ channel: "telegram" });
    expect(child).toBeDefined();
    expect(child.level).toBe("info");
  });

  it("writes log output to file when config.file is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-log-test-"));
    const file = join(dir, "test.log");

    const logger = createLogger({ level: "info", json: true, file });
    // Access the underlying SonicBoom stream via pino's symbol
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = (logger as any)[pino.symbols.streamSym];

    // Wait for SonicBoom to open the file descriptor before writing
    await new Promise<void>((resolve) => stream.on("ready", resolve));

    logger.info({ test: true }, "hello from logger test");

    // Flush the stream and wait for the OS write to complete
    await new Promise<void>((resolve) => stream.flush(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, "utf-8");
    expect(content).toContain("hello from logger test");
  });
});
