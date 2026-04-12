import { describe, it, expect } from "vitest";
import { formatDiffSummary } from "../../src/bridge/diff-summary.js";

describe("formatDiffSummary()", () => {
  it("formats a single file", () => {
    const result = formatDiffSummary({
      files: [{ path: "src/index.ts", additions: 10, deletions: 3 }],
    });
    expect(result).toContain("1 file");
    expect(result).toContain("+10");
    expect(result).toContain("-3");
    expect(result).toContain("src/index.ts");
  });

  it("formats multiple files", () => {
    const result = formatDiffSummary({
      files: [
        { path: "a.ts", additions: 1, deletions: 0 },
        { path: "b.ts", additions: 2, deletions: 1 },
        { path: "c.ts", additions: 3, deletions: 2 },
      ],
    });
    expect(result).toContain("3 files");
  });

  it("caps at 5 files with overflow indicator", () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      path: `file${i}.ts`,
      additions: i,
      deletions: 0,
    }));
    const result = formatDiffSummary({ files });
    expect(result).toContain("… and 3 more");
    expect(result).not.toContain("file5.ts");
  });

  it("returns separator line", () => {
    const result = formatDiffSummary({
      files: [{ path: "x.ts", additions: 0, deletions: 0 }],
    });
    expect(result).toMatch(/^────/);
  });
});
