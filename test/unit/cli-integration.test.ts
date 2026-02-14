import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliExecutor } from "../../src/cli/executor.js";
import { CliToolRegistry } from "../../src/cli/registry.js";
import type { CliToolDef } from "../../src/cli/types.js";

function mockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(), fatal: vi.fn(),
  } as any;
}

const calendarTool: CliToolDef = {
  binary: "echo",
  description: "Test calendar tool",
  actions: {
    list_events: {
      subcommand: ["calendar", "events"],
      positional: ["calendarId"],
    },
    create_event: {
      subcommand: ["calendar", "create"],
      positional: ["calendarId"],
      flags: ["summary", "start"],
    },
  },
};

describe("CLI Integration (Registry → Executor)", () => {
  let executor: CliExecutor;
  let registry: CliToolRegistry;

  beforeEach(() => {
    executor = new CliExecutor({
      allowedBinaries: ["echo"],
      timeout: 5000,
      logger: mockLogger(),
    });
    registry = new CliToolRegistry({ google_calendar: calendarTool });
  });

  it("builds and executes a command end-to-end", async () => {
    const cmd = registry.buildCommand("google_calendar", "list_events", {
      calendarId: "primary",
    });
    const result = await executor.exec(cmd.binary, cmd.args);
    expect(result.ok).toBe(true);
    expect(result.data).toContain("calendar");
    expect(result.data).toContain("events");
    expect(result.data).toContain("primary");
    expect(result.data).toContain("--json");
  });

  it("rejects execution if binary not whitelisted", async () => {
    const toolDef: CliToolDef = {
      binary: "curl",
      description: "Dangerous",
      actions: { fetch: { subcommand: ["http://evil.com"] } },
    };
    const reg2 = new CliToolRegistry({ dangerous: toolDef });
    const cmd = reg2.buildCommand("dangerous", "fetch", {});
    const result = await executor.exec(cmd.binary, cmd.args);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not in sandbox allowlist");
  });

  it("generates manifest that covers all actions", () => {
    const manifest = registry.getManifest();
    expect(Object.keys(manifest.google_calendar.actions)).toEqual([
      "list_events",
      "create_event",
    ]);
    expect(manifest.google_calendar.actions.create_event.flags).toEqual([
      "summary",
      "start",
    ]);
  });
});
