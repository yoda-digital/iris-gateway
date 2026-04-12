import { describe, it, expect } from "vitest";
import { formatDiffSummary } from "../../src/bridge/diff-summary.js";

describe("formatDiffSummary", () => {
  it("formats single file diff", () => {
    const result = formatDiffSummary({
      files: [{ path: "src/foo.ts", additions: 12, deletions: 4 }],
    });
    expect(result).toContain("📝 Changes: 1 file");
    expect(result).toContain("src/foo.ts");
    expect(result).toContain("+");
    expect(result).toContain("-");
  });

  it("formats multiple files", () => {
    const result = formatDiffSummary({
      files: [
        { path: "src/a.ts", additions: 10, deletions: 2 },
        { path: "src/b.ts", additions: 5, deletions: 0 },
        { path: "src/c.ts", additions: 1, deletions: 1 },
      ],
    });
    expect(result).toContain("📝 Changes: 3 files");
    expect(result).toContain("src/a.ts");
    expect(result).toContain("src/b.ts");
    expect(result).toContain("src/c.ts");
  });

  it("caps at 5 files with overflow", () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      additions: i + 1,
      deletions: 0,
    }));
    const result = formatDiffSummary({ files });
    expect(result).toContain("📝 Changes: 8 files");
    expect(result).toContain("… and 3 more");
    expect(result).not.toContain("file-5");
  });

  it("uses singular for 1 file", () => {
    const result = formatDiffSummary({
      files: [{ path: "README.md", additions: 1, deletions: 0 }],
    });
    expect(result).toContain("1 file");
    expect(result).not.toContain("1 files");
  });
});
