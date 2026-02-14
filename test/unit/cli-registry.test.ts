import { describe, it, expect, beforeEach } from "vitest";
import { CliToolRegistry } from "../../src/cli/registry.js";
import type { CliToolDef } from "../../src/cli/types.js";

const calendarTool: CliToolDef = {
  binary: "gog",
  description: "Manage Google Calendar",
  actions: {
    list_calendars: { subcommand: ["calendar", "calendars"] },
    list_events: {
      subcommand: ["calendar", "events"],
      positional: ["calendarId"],
    },
    create_event: {
      subcommand: ["calendar", "create"],
      positional: ["calendarId"],
      flags: ["summary", "start", "end"],
    },
  },
};

describe("CliToolRegistry", () => {
  let reg: CliToolRegistry;

  beforeEach(() => {
    reg = new CliToolRegistry({ google_calendar: calendarTool });
  });

  it("builds command for action with no args", () => {
    const cmd = reg.buildCommand("google_calendar", "list_calendars", {});
    expect(cmd).toEqual({
      binary: "gog",
      args: ["calendar", "calendars", "--json", "--no-input"],
    });
  });

  it("builds command with positional args", () => {
    const cmd = reg.buildCommand("google_calendar", "list_events", {
      calendarId: "primary",
    });
    expect(cmd).toEqual({
      binary: "gog",
      args: ["calendar", "events", "primary", "--json", "--no-input"],
    });
  });

  it("builds command with positional + flag args", () => {
    const cmd = reg.buildCommand("google_calendar", "create_event", {
      calendarId: "primary",
      summary: "Standup",
      start: "2026-02-15T09:00:00Z",
      end: "2026-02-15T09:30:00Z",
    });
    expect(cmd).toEqual({
      binary: "gog",
      args: [
        "calendar", "create", "primary",
        "--summary=Standup",
        "--start=2026-02-15T09:00:00Z",
        "--end=2026-02-15T09:30:00Z",
        "--json", "--no-input",
      ],
    });
  });

  it("throws on unknown tool", () => {
    expect(() => reg.buildCommand("unknown_tool", "list", {})).toThrow(
      "Unknown CLI tool: unknown_tool",
    );
  });

  it("throws on unknown action", () => {
    expect(() =>
      reg.buildCommand("google_calendar", "delete_calendar", {}),
    ).toThrow("Unknown action 'delete_calendar' for tool 'google_calendar'");
  });

  it("ignores flags not declared in action def", () => {
    const cmd = reg.buildCommand("google_calendar", "list_events", {
      calendarId: "primary",
      evilFlag: "injection",
    });
    expect(cmd.args).not.toContain("--evilFlag=injection");
  });

  it("generates tool manifest", () => {
    const manifest = reg.getManifest();
    expect(manifest.google_calendar).toBeDefined();
    expect(manifest.google_calendar.description).toBe("Manage Google Calendar");
    expect(manifest.google_calendar.actions.list_events.positional).toEqual([
      "calendarId",
    ]);
  });

  it("lists registered tools", () => {
    const tools = reg.listTools();
    expect(tools).toEqual(["google_calendar"]);
  });
});
