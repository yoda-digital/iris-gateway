import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

describe("detectOpenCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns info when 'opencode' binary is found", async () => {
    const { spawnSync } = await import("node:child_process");
    const mock = spawnSync as ReturnType<typeof vi.fn>;
    mock
      .mockReturnValueOnce({ status: 0, stdout: "/usr/local/bin/opencode\n" }) // which
      .mockReturnValueOnce({ status: 0, stdout: "1.5.0\n" }); // --version

    const { detectOpenCode } = await import("../../src/utils/opencode-detect.js");
    const result = detectOpenCode();

    expect(result).toEqual({ path: "/usr/local/bin/opencode", version: "1.5.0" });
  });

  it("falls back to 'opencode-ai' when 'opencode' not found", async () => {
    const { spawnSync } = await import("node:child_process");
    const mock = spawnSync as ReturnType<typeof vi.fn>;
    mock
      .mockReturnValueOnce({ status: 1, stdout: "" }) // which opencode → not found
      .mockReturnValueOnce({ status: 0, stdout: "/usr/bin/opencode-ai\n" }) // which opencode-ai
      .mockReturnValueOnce({ status: 0, stdout: "2.0.0\n" }); // --version

    const { detectOpenCode } = await import("../../src/utils/opencode-detect.js");
    const result = detectOpenCode();

    expect(result).toEqual({ path: "/usr/bin/opencode-ai", version: "2.0.0" });
  });

  it("returns null when no binary is found", async () => {
    const { spawnSync } = await import("node:child_process");
    const mock = spawnSync as ReturnType<typeof vi.fn>;
    mock.mockReturnValue({ status: 1, stdout: "" });

    const { detectOpenCode } = await import("../../src/utils/opencode-detect.js");
    const result = detectOpenCode();

    expect(result).toBeNull();
  });

  it("returns version 'unknown' when --version fails", async () => {
    const { spawnSync } = await import("node:child_process");
    const mock = spawnSync as ReturnType<typeof vi.fn>;
    mock
      .mockReturnValueOnce({ status: 0, stdout: "/usr/bin/opencode\n" }) // which
      .mockReturnValueOnce({ status: 1, stdout: "" }); // --version fails

    const { detectOpenCode } = await import("../../src/utils/opencode-detect.js");
    const result = detectOpenCode();

    expect(result).toEqual({ path: "/usr/bin/opencode", version: "unknown" });
  });
});

describe("installOpenCode", () => {
  it("returns true on successful install", async () => {
    const { spawnSync } = await import("node:child_process");
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0 });

    const { installOpenCode } = await import("../../src/utils/opencode-detect.js");
    expect(installOpenCode()).toBe(true);
  });

  it("returns false on failed install", async () => {
    const { spawnSync } = await import("node:child_process");
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 1 });

    const { installOpenCode } = await import("../../src/utils/opencode-detect.js");
    expect(installOpenCode()).toBe(false);
  });
});
