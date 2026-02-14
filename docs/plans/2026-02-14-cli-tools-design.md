# CLI Tool Integration: Grouped Tools Design

## Context

Iris currently has no way to interact with external services beyond messaging channels. To become a true executive assistant, it needs access to Google Calendar, Gmail, Contacts, Drive, Tasks, etc. The approach: wrap local CLI tools (starting with `gog`) as Iris tools, using a sandboxed executor with config-driven tool registry.

MCP integration is NOT excluded — both approaches coexist. CLI is the base/focus because it works offline, costs $0, and covers Google's full API surface via `gog`.

## Approach: Grouped Tools

One Iris tool per CLI domain (google_calendar, google_email, google_contacts, google_tasks, google_drive). Each tool accepts an `action` enum + domain-specific args. Internally, the tool server maps action+args to a CLI command via the registry.

**Why not Thin Wrappers (one tool per subcommand)?** Too many tools pollute the AI's context (30+ tools for gog alone). The AI struggles with tool selection when there are dozens.

**Why not Fat Router (single cli_exec)?** Too generic — the AI gets no guidance on which actions exist or what args they need. Untyped.

**Grouped Tools** hits the sweet spot: 5 well-described tools with typed action enums. The AI knows exactly what's available.

## Architecture

### New Files

- `src/cli/executor.ts` — Sandboxed child process runner
- `src/cli/registry.ts` — Config-driven tool definition registry
- `src/cli/types.ts` — Interfaces for CLI tool config

### Modified Files

- `src/config/schema.ts` — Add `cli` section to Zod schema
- `src/config/types.ts` — Add CliConfig interface
- `src/bridge/tool-server.ts` — Add `/cli/:toolName` route
- `src/gateway/lifecycle.ts` — Wire CLI registry + executor
- `.opencode/plugin/iris.ts` — Auto-register CLI tools from manifest
- `AGENTS.md` — Document CLI tools

### Component Details

#### 1. CLI Executor (`src/cli/executor.ts`)

Sandboxed child process runner. Responsibilities:
- Validate binary is in whitelist
- Validate subcommand path is allowed for that binary
- Build command array: `[binary, ...subcommand, ...positionalArgs, ...flagArgs, "--json", "--no-input"]`
- Spawn with `child_process.execFile` (NOT `exec` — no shell injection)
- Capture stdout + stderr
- Parse stdout as JSON (fallback to raw text on parse failure)
- Enforce timeout (default 10s)
- Return `{ ok: boolean, data?: unknown, error?: string, exitCode: number }`

Key security: `execFile` avoids shell interpolation. Binary must be absolute path or resolved via `which`. Args are array elements, never concatenated.

#### 2. CLI Tool Registry (`src/cli/registry.ts`)

Config-driven mapping from `(toolName, action)` → CLI command template. Responsibilities:
- Load tool definitions from IrisConfig `cli.tools` section
- For each tool, store: binary, description, action map
- For each action, store: subcommand array, positional arg names, flag names
- `buildCommand(toolName, action, args)` → validated command array
- `getToolManifest()` → JSON manifest for plugin auto-registration
- Write manifest to `~/.iris/cli-tools.json` on startup

Manifest format (read by plugin at tool registration):
```json
{
  "google_calendar": {
    "description": "Manage Google Calendar events and calendars",
    "actions": {
      "list_calendars": { "description": "List all calendars" },
      "list_events": { "positional": ["calendarId"], "flags": [] },
      "create_event": { "positional": ["calendarId"], "flags": ["summary", "start", "end", "description", "location"] }
    }
  }
}
```

#### 3. Tool Server Route

Single new route handles all CLI tools:

```
POST /cli/:toolName
Body: { action: string, ...args }
```

- Looks up toolName in registry
- Validates action exists
- Extracts positional + flag args from body
- Calls executor
- Returns JSON result

#### 4. Plugin Auto-Registration

The plugin reads `~/.iris/cli-tools.json` at startup (same pattern as `plugin-tools.json`). For each tool in the manifest, it registers a tool with:
- `action` arg: enum of available actions
- Dynamic args based on union of all positional + flag names across actions
- All args optional (which ones are needed depends on the action)
- Description includes action list with their args

#### 5. Sandbox Model: Binary + Argument Pattern

Config declares:
- `sandbox.allowedBinaries`: list of binary names (resolved to absolute paths at startup)
- Each tool declaration implicitly whitelists its subcommand paths

The executor validates:
1. Binary is in `allowedBinaries`
2. The subcommand being built matches a declared action's subcommand

This prevents:
- Arbitrary binary execution (only whitelisted binaries)
- Dangerous subcommands (only declared actions, e.g. no `gog auth`)
- Shell injection (execFile, not exec)

## Config Schema

```yaml
cli:
  enabled: true
  timeout: 10000
  sandbox:
    allowedBinaries:
      - gog
  tools:
    google_calendar:
      binary: gog
      description: "Manage Google Calendar events and calendars"
      actions:
        list_calendars:
          subcommand: ["calendar", "calendars"]
        list_events:
          subcommand: ["calendar", "events"]
          positional: ["calendarId"]
        get_event:
          subcommand: ["calendar", "event"]
          positional: ["calendarId", "eventId"]
        create_event:
          subcommand: ["calendar", "create"]
          positional: ["calendarId"]
          flags: ["summary", "start", "end", "description", "location"]
        update_event:
          subcommand: ["calendar", "update"]
          positional: ["calendarId", "eventId"]
          flags: ["summary", "start", "end", "description", "location"]
    google_email:
      binary: gog
      description: "Search and manage Gmail"
      actions:
        search:
          subcommand: ["gmail", "search"]
          positional: ["query"]
          flags: ["max"]
        get_message:
          subcommand: ["gmail", "get"]
          positional: ["messageId"]
        send:
          subcommand: ["gmail", "messages", "send"]
          flags: ["to", "subject", "body", "cc", "bcc"]
    google_contacts:
      binary: gog
      description: "Manage Google Contacts"
      actions:
        search:
          subcommand: ["contacts", "search"]
          positional: ["query"]
        list:
          subcommand: ["contacts", "list"]
        get:
          subcommand: ["contacts", "get"]
          positional: ["resourceName"]
        create:
          subcommand: ["contacts", "create"]
          flags: ["name", "email", "phone"]
        update:
          subcommand: ["contacts", "update"]
          positional: ["resourceName"]
          flags: ["name", "email", "phone"]
        delete:
          subcommand: ["contacts", "delete"]
          positional: ["resourceName"]
    google_tasks:
      binary: gog
      description: "Manage Google Tasks"
      actions:
        list_tasklists:
          subcommand: ["tasks", "lists", "list"]
        list_tasks:
          subcommand: ["tasks", "list"]
          positional: ["tasklistId"]
        get:
          subcommand: ["tasks", "get"]
          positional: ["tasklistId", "taskId"]
        add:
          subcommand: ["tasks", "add"]
          positional: ["tasklistId"]
          flags: ["title", "notes", "due"]
        update:
          subcommand: ["tasks", "update"]
          positional: ["tasklistId", "taskId"]
          flags: ["title", "notes", "due", "status"]
        complete:
          subcommand: ["tasks", "done"]
          positional: ["tasklistId", "taskId"]
    google_drive:
      binary: gog
      description: "Browse and search Google Drive"
      actions:
        list:
          subcommand: ["drive", "ls"]
          flags: ["folder"]
        search:
          subcommand: ["drive", "search"]
          positional: ["query"]
        get:
          subcommand: ["drive", "get"]
          positional: ["fileId"]
```

## Data Flow

```
AI calls google_calendar({ action: "create_event", calendarId: "primary", summary: "Standup", start: "2026-02-15T09:00:00Z", end: "2026-02-15T09:30:00Z" })
  → Plugin POSTs /cli/google_calendar { action: "create_event", calendarId: "primary", summary: "Standup", start: "...", end: "..." }
  → Tool server looks up "google_calendar" in registry
  → Registry resolves action "create_event":
    subcommand: ["calendar", "create"]
    positional: ["calendarId"] → "primary"
    flags: ["summary", "start", "end"] → "--summary=Standup", "--start=...", "--end=..."
  → Executor builds: ["gog", "calendar", "create", "primary", "--summary=Standup", "--start=...", "--end=...", "--json", "--no-input"]
  → Validates: "gog" in allowedBinaries ✓, "calendar create" matches declared subcommand ✓
  → execFile("gog", [...args], { timeout: 10000 })
  → Captures stdout JSON → returns to AI
```

## Error Handling

- Binary not found: `{ ok: false, error: "Binary 'gog' not found in PATH" }`
- Binary not whitelisted: `{ ok: false, error: "Binary 'bird' not in sandbox allowlist" }`
- Action not found: `{ ok: false, error: "Unknown action 'delete_calendar' for tool 'google_calendar'" }`
- Timeout: `{ ok: false, error: "Command timed out after 10000ms" }`
- Non-zero exit: `{ ok: false, error: "gog exited with code 1: <stderr>" }`
- JSON parse failure: `{ ok: true, data: "<raw stdout text>" }` (graceful fallback)

## Breaking Changes

None. All new functionality. Existing tools unaffected.

## Risks

| Risk | Mitigation |
|------|-----------|
| Command injection | execFile (no shell), array args, binary whitelist |
| gog not installed | Graceful error, tools still register but return "binary not found" |
| gog auth expires | Return gog's error message directly, user re-auths manually |
| Too many flags confuse AI | Good tool descriptions with action-specific arg docs |
| Config verbosity | Future: auto-discover actions from `gog --help` parsing |

## Future Extensions

- Auto-discover actions from CLI `--help` output (reduce config boilerplate)
- TypeScript tool overrides for complex arg transformation
- Per-agent CLI tool access control (subset of actions)
- Sub-agent skills that compose multiple CLI calls (e.g., "schedule meeting with X" = contacts search + calendar create)
- Additional binaries: `bird` (Twitter), `himalaya` (email), etc.
