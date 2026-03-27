import { describe, it, expect, vi, beforeEach } from "vitest";
import { Writable } from "node:stream";

// Helper to capture stdout
function captureStdout(): { stream: Writable; output: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk, _encoding, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, output: () => buf };
}

const mockScanDirectory = vi.fn();

vi.mock("../../src/security/scanner.js", () => ({
  SecurityScanner: vi.fn().mockImplementation(() => ({
    scanDirectory: mockScanDirectory,
  })),
}));

describe("CLI: ScanCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanDirectory.mockReset();
  });

  async function makeScanCommand(targetDir?: string) {
    const { ScanCommand } = await import("../../src/cli/commands/scan.js");
    const cmd = new ScanCommand();
    // Override Clipanion Option descriptor with real value
    Object.defineProperty(cmd, "targetDir", { value: targetDir, writable: true, configurable: true });
    return cmd;
  }

  it("happy path: no findings → exits 0 and prints 'No issues found.'", async () => {
    mockScanDirectory.mockResolvedValue({
      scannedFiles: 5,
      findings: [],
      critical: 0,
      warn: 0,
      info: 0,
      safe: true,
    });

    const cmd = await makeScanCommand();
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream } as typeof cmd.context;

    const exitCode = await cmd.execute();

    expect(exitCode).toBe(0);
    expect(output()).toContain("No issues found.");
    expect(output()).toContain("Scanned 5 files");
  });

  it("findings path: critical findings → prints findings, exits 1 when not safe", async () => {
    mockScanDirectory.mockResolvedValue({
      scannedFiles: 3,
      findings: [
        { ruleId: "dynamic-eval", severity: "critical", file: "bad.ts", line: 10, message: "eval detected", evidence: "eval('x')" },
        { ruleId: "env-harvesting", severity: "warn", file: "bad.ts", line: 20, message: "env+fetch", evidence: "fetch(env)" },
      ],
      critical: 1,
      warn: 1,
      info: 0,
      safe: false,
    });

    const cmd = await makeScanCommand();
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream } as typeof cmd.context;

    const exitCode = await cmd.execute();

    expect(exitCode).toBe(1);
    expect(output()).toContain("Findings: 1 critical, 1 warnings, 0 info");
    expect(output()).toContain("dynamic-eval");
    expect(output()).toContain("env-harvesting");
    expect(output()).toContain("bad.ts:10");
    expect(output()).toContain("bad.ts:20");
  });

  it("safe with findings → exits 0 when safe=true", async () => {
    mockScanDirectory.mockResolvedValue({
      scannedFiles: 2,
      findings: [
        { ruleId: "some-info", severity: "info", file: "ok.ts", line: 5, message: "info finding", evidence: "info()" },
      ],
      critical: 0,
      warn: 0,
      info: 1,
      safe: true,
    });

    const cmd = await makeScanCommand();
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream } as typeof cmd.context;

    const exitCode = await cmd.execute();

    expect(exitCode).toBe(0);
    expect(output()).toContain("some-info");
  });

  it("custom targetDir option exercises resolve() path", async () => {
    mockScanDirectory.mockResolvedValue({
      scannedFiles: 0,
      findings: [],
      critical: 0,
      warn: 0,
      info: 0,
      safe: true,
    });

    const cmd = await makeScanCommand("./some/custom/dir");
    const { stream, output } = captureStdout();
    cmd.context = { ...cmd.context, stdout: stream } as typeof cmd.context;

    await cmd.execute();

    expect(mockScanDirectory).toHaveBeenCalledWith(expect.stringContaining("some/custom/dir"));
    expect(output()).toContain("Scanning");
  });
});
