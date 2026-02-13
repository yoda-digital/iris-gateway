import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withFileLock } from "../../src/utils/file-lock.js";

describe("withFileLock", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-test-"));
    filePath = join(tempDir, "test.json");
    writeFileSync(filePath, "[]");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("executes function and returns result", async () => {
    const result = await withFileLock(filePath, () => 42);
    expect(result).toBe(42);
  });

  it("executes async function and returns result", async () => {
    const result = await withFileLock(filePath, async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "hello";
    });
    expect(result).toBe("hello");
  });

  it("releases lock after function completes", async () => {
    await withFileLock(filePath, () => "first");
    // Should be able to acquire lock again
    const result = await withFileLock(filePath, () => "second");
    expect(result).toBe("second");
  });

  it("releases lock even on error", async () => {
    await expect(
      withFileLock(filePath, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Should still be able to acquire lock
    const result = await withFileLock(filePath, () => "after-error");
    expect(result).toBe("after-error");
  });

  it("serializes concurrent access", async () => {
    const order: number[] = [];

    const p1 = withFileLock(filePath, async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });

    const p2 = withFileLock(filePath, async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });
});
