import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliExecutor } from "../../src/cli/executor.js";

function mockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(), fatal: vi.fn(),
  } as any;
}

describe("CliExecutor", () => {
  let executor: CliExecutor;

  beforeEach(() => {
    executor = new CliExecutor({
      allowedBinaries: ["echo", "gog"],
      timeout: 5000,
      logger: mockLogger(),
    });
  });

  it("rejects unlisted binary", async () => {
    const result = await executor.exec("curl", ["http://evil.com"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not in sandbox allowlist");
    expect(result.exitCode).toBe(-1);
  });

  it("executes whitelisted binary and parses JSON stdout", async () => {
    const result = await executor.exec("echo", ['{"hello":"world"}']);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ hello: "world" });
    expect(result.exitCode).toBe(0);
  });

  it("returns raw text when stdout is not JSON", async () => {
    const result = await executor.exec("echo", ["plain text"]);
    expect(result.ok).toBe(true);
    expect(result.data).toBe("plain text");
    expect(result.exitCode).toBe(0);
  });

  it("handles non-zero exit code", async () => {
    executor = new CliExecutor({
      allowedBinaries: ["false"],
      timeout: 5000,
      logger: mockLogger(),
    });
    const result = await executor.exec("false", []);
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("handles timeout", async () => {
    executor = new CliExecutor({
      allowedBinaries: ["sleep"],
      timeout: 100,
      logger: mockLogger(),
    });
    const result = await executor.exec("sleep", ["10"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });
});
