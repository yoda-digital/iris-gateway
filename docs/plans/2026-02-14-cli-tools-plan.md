# CLI Tool Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wrap local CLI tools (starting with `gog` for Google services) as sandboxed Iris tools so the AI can manage calendars, email, contacts, tasks, and drive.

**Architecture:** Config-driven CLI tool registry maps grouped tool names + actions to CLI commands. A sandboxed executor spawns child processes with `execFile` (no shell injection), validates binaries + subcommands against whitelists, always appends `--json --no-input`. Plugin auto-registers tools from a manifest file.

**Tech Stack:** Node.js `child_process.execFile`, Zod validation, Hono routes, existing Iris plugin pattern.

---

### Task 1: CLI Types

**Files:**
- Create: `src/cli/types.ts`

**Step 1: Create the types file**

```typescript
export interface CliActionDef {
  readonly subcommand: string[];
  readonly positional?: string[];
  readonly flags?: string[];
}

export interface CliToolDef {
  readonly binary: string;
  readonly description: string;
  readonly actions: Record<string, CliActionDef>;
}

export interface CliSandboxConfig {
  readonly allowedBinaries: string[];
}

export interface CliConfig {
  readonly enabled: boolean;
  readonly timeout: number;
  readonly sandbox: CliSandboxConfig;
  readonly tools: Record<string, CliToolDef>;
}

export interface CliExecResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly exitCode: number;
}

export interface CliToolManifest {
  [toolName: string]: {
    description: string;
    actions: Record<string, {
      positional?: string[];
      flags?: string[];
    }>;
  };
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS (no compilation errors)

**Step 3: Commit**

```bash
git add src/cli/types.ts
git commit -m "feat(cli): add CLI tool type definitions"
```

---

### Task 2: CLI Executor

**Files:**
- Create: `src/cli/executor.ts`
- Create: `test/unit/cli-executor.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliExecutor } from "../../src/cli/executor.js";

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
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
    // 'false' exits with code 1
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/cli-executor.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
import { execFile } from "node:child_process";
import { which } from "../config/paths.js";
import type { CliExecResult } from "./types.js";
import type { Logger } from "../logging/logger.js";

export interface CliExecutorOpts {
  allowedBinaries: string[];
  timeout: number;
  logger: Logger;
}

export class CliExecutor {
  private readonly allowed: Set<string>;
  private readonly timeout: number;
  private readonly logger: Logger;

  constructor(opts: CliExecutorOpts) {
    this.allowed = new Set(opts.allowedBinaries);
    this.timeout = opts.timeout;
    this.logger = opts.logger;
  }

  async exec(binary: string, args: string[]): Promise<CliExecResult> {
    if (!this.allowed.has(binary)) {
      return {
        ok: false,
        error: `Binary '${binary}' not in sandbox allowlist`,
        exitCode: -1,
      };
    }

    return new Promise<CliExecResult>((resolve) => {
      execFile(
        binary,
        args,
        { timeout: this.timeout, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const output = stdout.trim();

          if (error) {
            // Check for timeout (SIGTERM from timeout option)
            if (error.killed || (error as any).code === "ETIMEDOUT") {
              resolve({
                ok: false,
                error: `Command timed out after ${this.timeout}ms`,
                exitCode: -1,
              });
              return;
            }

            resolve({
              ok: false,
              error: stderr.trim() || error.message,
              exitCode: error.code != null ? (typeof error.code === "number" ? error.code : 1) : 1,
            });
            return;
          }

          // Try JSON parse, fallback to raw text
          let data: unknown;
          try {
            data = JSON.parse(output);
          } catch {
            data = output;
          }

          resolve({ ok: true, data, exitCode: 0 });
        },
      );
    });
  }
}
```

**Step 4: Check if `which` exists in config/paths, if not add a comment that we use binary name directly**

Look at `src/config/paths.ts` — if `which` is not exported, remove the import. The `execFile` will resolve from PATH automatically. Update the import to just:

```typescript
import { execFile } from "node:child_process";
import type { CliExecResult } from "./types.js";
import type { Logger } from "../logging/logger.js";
```

**Step 5: Run tests**

Run: `npx vitest run test/unit/cli-executor.test.ts`
Expected: PASS (all 5 tests)

**Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 7: Commit**

```bash
git add src/cli/executor.ts test/unit/cli-executor.test.ts
git commit -m "feat(cli): add sandboxed CLI executor with tests"
```

---

### Task 3: CLI Registry

**Files:**
- Create: `src/cli/registry.ts`
- Create: `test/unit/cli-registry.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
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
    // evilFlag should be ignored since it's not in positional or flags
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

  it("validates subcommand is declared (sandbox)", () => {
    // The buildCommand itself only builds declared actions,
    // so there's no way to build an arbitrary subcommand
    const tools = reg.listTools();
    expect(tools).toEqual(["google_calendar"]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/cli-registry.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
import type { CliToolDef, CliToolManifest } from "./types.js";

export interface BuiltCommand {
  binary: string;
  args: string[];
}

export class CliToolRegistry {
  private readonly tools: Record<string, CliToolDef>;

  constructor(tools: Record<string, CliToolDef>) {
    this.tools = tools;
  }

  buildCommand(
    toolName: string,
    action: string,
    args: Record<string, string>,
  ): BuiltCommand {
    const toolDef = this.tools[toolName];
    if (!toolDef) {
      throw new Error(`Unknown CLI tool: ${toolName}`);
    }

    const actionDef = toolDef.actions[action];
    if (!actionDef) {
      throw new Error(
        `Unknown action '${action}' for tool '${toolName}'`,
      );
    }

    const cmdArgs: string[] = [...actionDef.subcommand];

    // Add positional args in order
    if (actionDef.positional) {
      for (const name of actionDef.positional) {
        if (args[name] != null) {
          cmdArgs.push(args[name]);
        }
      }
    }

    // Add declared flags
    if (actionDef.flags) {
      for (const flag of actionDef.flags) {
        if (args[flag] != null) {
          cmdArgs.push(`--${flag}=${args[flag]}`);
        }
      }
    }

    // Always append --json --no-input
    cmdArgs.push("--json", "--no-input");

    return { binary: toolDef.binary, args: cmdArgs };
  }

  listTools(): string[] {
    return Object.keys(this.tools);
  }

  getToolDef(toolName: string): CliToolDef | undefined {
    return this.tools[toolName];
  }

  getManifest(): CliToolManifest {
    const manifest: CliToolManifest = {};
    for (const [name, def] of Object.entries(this.tools)) {
      manifest[name] = {
        description: def.description,
        actions: {},
      };
      for (const [actionName, actionDef] of Object.entries(def.actions)) {
        manifest[name].actions[actionName] = {
          positional: actionDef.positional,
          flags: actionDef.flags,
        };
      }
    }
    return manifest;
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run test/unit/cli-registry.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli/registry.ts test/unit/cli-registry.test.ts
git commit -m "feat(cli): add CLI tool registry with command builder"
```

---

### Task 4: Config Schema + Types

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/types.ts`

**Step 1: Add Zod schema for CLI config**

In `src/config/schema.ts`, add before the `irisConfigSchema` definition (before line 210):

```typescript
const cliActionSchema = z.object({
  subcommand: z.array(z.string().min(1)),
  positional: z.array(z.string().min(1)).optional(),
  flags: z.array(z.string().min(1)).optional(),
});

const cliToolSchema = z.object({
  binary: z.string().min(1),
  description: z.string().min(1),
  actions: z.record(z.string(), cliActionSchema),
});

const cliSchema = z.object({
  enabled: z.boolean().default(false),
  timeout: z.number().positive().default(10_000),
  sandbox: z.object({
    allowedBinaries: z.array(z.string().min(1)).default([]),
  }).default({}),
  tools: z.record(z.string(), cliToolSchema).default({}),
});
```

Add `cli: cliSchema.optional(),` to the `irisConfigSchema` object (after `heartbeat` line).

**Step 2: Add CliConfig to types.ts**

In `src/config/types.ts`, add to the `IrisConfig` interface:

```typescript
readonly cli?: import("../cli/types.js").CliConfig;
```

And add the re-export at the bottom:

```typescript
export type { CliConfig } from "../cli/types.js";
```

**Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/config/schema.ts src/config/types.ts
git commit -m "feat(config): add CLI tool config schema and types"
```

---

### Task 5: Tool Server CLI Route

**Files:**
- Modify: `src/bridge/tool-server.ts`

**Step 1: Add CLI executor + registry to ToolServerDeps**

In `src/bridge/tool-server.ts`, add imports at the top:

```typescript
import type { CliExecutor } from "../cli/executor.js";
import type { CliToolRegistry } from "../cli/registry.js";
```

Add to `ToolServerDeps` interface:

```typescript
cliExecutor?: CliExecutor | null;
cliRegistry?: CliToolRegistry | null;
```

Add private fields to `ToolServer` class:

```typescript
private readonly cliExecutor: CliExecutor | null;
private readonly cliRegistry: CliToolRegistry | null;
```

Wire in both constructor paths:
- Legacy path: `this.cliExecutor = null; this.cliRegistry = null;`
- Deps path: `this.cliExecutor = deps.cliExecutor ?? null; this.cliRegistry = deps.cliRegistry ?? null;`

**Step 2: Add the `/cli/:toolName` route**

Add to `setupRoutes()`, near the heartbeat routes (after line ~1265):

```typescript
const cliExecSchema = z.object({
  action: z.string().min(1),
}).passthrough();

this.app.post("/cli/:toolName", async (c) => {
  if (!this.cliExecutor || !this.cliRegistry) {
    return c.json({ error: "CLI tools not configured" }, 503);
  }

  const toolName = c.req.param("toolName");
  const parsed = cliExecSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { action, ...args } = parsed.data;

  try {
    const cmd = this.cliRegistry.buildCommand(
      toolName,
      action,
      args as Record<string, string>,
    );
    const result = await this.cliExecutor.exec(cmd.binary, cmd.args);
    return c.json(result);
  } catch (err) {
    this.logger.error({ err, toolName, action }, "CLI tool execution failed");
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), exitCode: -1 },
      400,
    );
  }
});
```

**Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/bridge/tool-server.ts
git commit -m "feat(cli): add /cli/:toolName route to tool server"
```

---

### Task 6: Lifecycle Wiring

**Files:**
- Modify: `src/gateway/lifecycle.ts`

**Step 1: Add imports**

```typescript
import { CliExecutor } from "../cli/executor.js";
import { CliToolRegistry } from "../cli/registry.js";
```

**Step 2: Initialize CLI components after heartbeat init (after line ~193)**

Add a new section between heartbeat init and plugin loading:

```typescript
// 5.76 Initialize CLI tools
let cliExecutor: CliExecutor | null = null;
let cliRegistry: CliToolRegistry | null = null;
if (config.cli?.enabled) {
  cliRegistry = new CliToolRegistry(config.cli.tools);
  cliExecutor = new CliExecutor({
    allowedBinaries: config.cli.sandbox.allowedBinaries,
    timeout: config.cli.timeout,
    logger,
  });

  // Write manifest for plugin auto-registration
  const manifestPath = join(stateDir, "cli-tools.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(manifestPath, JSON.stringify(cliRegistry.getManifest(), null, 2));
  logger.info({ tools: cliRegistry.listTools() }, "CLI tool registry initialized");
}
```

**Step 3: Pass to ToolServer constructor**

In the `new ToolServer({...})` call (~line 265), add:

```typescript
cliExecutor,
cliRegistry,
```

**Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/gateway/lifecycle.ts
git commit -m "feat(cli): wire CLI executor and registry into gateway lifecycle"
```

---

### Task 7: Plugin Auto-Registration

**Files:**
- Modify: `.opencode/plugin/iris.ts`

**Step 1: Add CLI tool loader function**

After the existing `loadPluginTools()` function (~line 70), add:

```typescript
interface CliToolManifest {
  [toolName: string]: {
    description: string;
    actions: Record<string, {
      positional?: string[];
      flags?: string[];
    }>;
  };
}

function loadCliTools(): Record<string, ReturnType<typeof tool>> {
  const manifestPath =
    process.env.IRIS_STATE_DIR
      ? join(process.env.IRIS_STATE_DIR, "cli-tools.json")
      : join(homedir(), ".iris", "cli-tools.json");

  let manifest: CliToolManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as CliToolManifest;
  } catch {
    return {};
  }

  const tools: Record<string, ReturnType<typeof tool>> = {};
  for (const [name, def] of Object.entries(manifest)) {
    // Build action enum description
    const actionDocs = Object.entries(def.actions)
      .map(([action, actionDef]) => {
        const parts = [action];
        if (actionDef.positional?.length) parts.push(`(args: ${actionDef.positional.join(", ")})`);
        if (actionDef.flags?.length) parts.push(`[flags: ${actionDef.flags.join(", ")}]`);
        return `  - ${parts.join(" ")}`;
      })
      .join("\n");

    const actionNames = Object.keys(def.actions);

    // Collect all possible arg names across all actions
    const allArgs = new Set<string>();
    for (const actionDef of Object.values(def.actions)) {
      if (actionDef.positional) actionDef.positional.forEach((a) => allArgs.add(a));
      if (actionDef.flags) actionDef.flags.forEach((a) => allArgs.add(a));
    }

    const toolArgs: Record<string, ReturnType<typeof tool.schema.string>> = {
      action: tool.schema
        .string()
        .describe(`Action to perform. One of: ${actionNames.join(", ")}`),
    };

    for (const argName of allArgs) {
      toolArgs[argName] = tool.schema
        .string()
        .optional()
        .describe(`Argument for CLI tool (used by actions that need it)`);
    }

    tools[name] = tool({
      description: `${def.description}\n\nAvailable actions:\n${actionDocs}`,
      args: toolArgs,
      async execute(execArgs) {
        return JSON.stringify(
          await irisPost(`/cli/${name}`, execArgs),
        );
      },
    });
  }
  return tools;
}
```

**Step 2: Spread CLI tools into the tool object**

In the tool object (line ~74), add the CLI tools spread:

```typescript
tool: {
    ...loadPluginTools(),
    ...loadCliTools(),
    send_message: tool({
```

**Step 3: Add CLI tool names to the irisToolCatalog**

Find the `irisToolCatalog` array in the plugin file and add:

```typescript
"google_calendar", "google_email", "google_contacts", "google_tasks", "google_drive",
```

**Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add .opencode/plugin/iris.ts
git commit -m "feat(cli): auto-register CLI tools in OpenCode plugin"
```

---

### Task 8: AGENTS.md + Cookbook

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/cookbook.md`

**Step 1: Add CLI tools section to AGENTS.md**

After the Heartbeat section, add:

```markdown
### CLI Tools (External Service Integration)
- Use `google_calendar` to list calendars, list/get/create/update events
- Use `google_email` to search threads, get messages, send email
- Use `google_contacts` to search/list/get/create/update/delete contacts
- Use `google_tasks` to manage task lists and tasks (list, add, update, complete)
- Use `google_drive` to list files, search, and get file metadata
- All CLI tools use the `gog` binary with `--json` output
- Actions are sandboxed: only declared subcommands can be executed
- When using these tools, always specify the `action` parameter
```

**Step 2: Add CLI tools section to cookbook.md**

Add a new section with YAML config example and usage examples.

**Step 3: Commit**

```bash
git add AGENTS.md docs/cookbook.md
git commit -m "docs: add CLI tools section to AGENTS.md and cookbook"
```

---

### Task 9: Integration Test

**Files:**
- Create: `test/unit/cli-integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliExecutor } from "../../src/cli/executor.js";
import { CliToolRegistry } from "../../src/cli/registry.js";
import type { CliToolDef } from "../../src/cli/types.js";

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
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
    // echo outputs args as text, verify our command was built correctly
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
```

**Step 2: Run tests**

Run: `npx vitest run test/unit/cli-integration.test.ts`
Expected: PASS

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All new CLI tests pass. Pre-existing failures in pipeline/message-router tests are known.

**Step 4: Commit**

```bash
git add test/unit/cli-integration.test.ts
git commit -m "test(cli): add integration test for registry → executor pipeline"
```

---

### Task 10: Full Test Suite Verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All new tests pass (executor: 5, registry: 8, integration: 3 = 16 new tests).

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Verify all 10 tasks are complete**

Check:
- `src/cli/types.ts` — exists, exports all interfaces
- `src/cli/executor.ts` — exists, sandboxed execFile
- `src/cli/registry.ts` — exists, builds commands from config
- `src/config/schema.ts` — has `cliSchema`
- `src/config/types.ts` — has `cli?: CliConfig`
- `src/bridge/tool-server.ts` — has `/cli/:toolName` route
- `src/gateway/lifecycle.ts` — wires CLI components
- `.opencode/plugin/iris.ts` — has `loadCliTools()`
- `AGENTS.md` — has CLI tools section
- `test/unit/cli-executor.test.ts` — 5 tests
- `test/unit/cli-registry.test.ts` — 8 tests
- `test/unit/cli-integration.test.ts` — 3 tests
