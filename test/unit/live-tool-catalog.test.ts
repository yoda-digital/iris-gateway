import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { buildHandlerDirs, IRIS_TOOL_CATALOG } from "../../src/bridge/routers/skills-handlers.js";
import type { OpenCodeBridge } from "../../src/bridge/opencode-client.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(`${tmpdir()}/iris-live-catalog-test-`);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildHandlerDirs — live tool catalog", () => {
  it("uses static IRIS_TOOL_CATALOG when bridge is not provided", () => {
    const dirs = buildHandlerDirs({ workingDir: tmpDir });
    expect(dirs.irisToolCatalog).toEqual(expect.arrayContaining(IRIS_TOOL_CATALOG));
  });

  it("uses static catalog when bridge getLiveToolCatalog() returns empty array", () => {
    const bridge = { getLiveToolCatalog: vi.fn().mockReturnValue([]) } as unknown as OpenCodeBridge;
    const dirs = buildHandlerDirs({ workingDir: tmpDir, bridge });
    expect(dirs.irisToolCatalog).toEqual(expect.arrayContaining(IRIS_TOOL_CATALOG));
  });

  it("uses live catalog when bridge getLiveToolCatalog() returns tools", () => {
    const liveCatalog = ["live_tool_a", "live_tool_b", "mcp_custom_tool"];
    const bridge = { getLiveToolCatalog: vi.fn().mockReturnValue(liveCatalog) } as unknown as OpenCodeBridge;
    const dirs = buildHandlerDirs({ workingDir: tmpDir, bridge });
    expect(dirs.irisToolCatalog).toEqual(liveCatalog);
    // Should NOT contain static catalog entries
    expect(dirs.irisToolCatalog).not.toContain("send_message — Send text messages to any channel");
  });

  it("falls back to static catalog when bridge is null", () => {
    const dirs = buildHandlerDirs({ workingDir: tmpDir, bridge: null });
    expect(dirs.irisToolCatalog).toEqual(expect.arrayContaining(IRIS_TOOL_CATALOG));
  });
});
