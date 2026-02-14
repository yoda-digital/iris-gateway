# Configuration Reference

Iris is configured through a JSON file and environment variables. This document covers every configuration option in detail.

## Config File Location

By default, Iris looks for `iris.config.json` in the current working directory. Override this with:

- The `--config` / `-c` flag: `iris gateway run --config /path/to/config.json`
- The `IRIS_CONFIG_PATH` environment variable: `export IRIS_CONFIG_PATH=/etc/iris/config.json`

The config file is optional. If it does not exist, Iris uses default values for all settings.

## Config File Format

The config file is standard JSON. All top-level sections are optional and have sensible defaults.

```json
{
  "gateway": { ... },
  "channels": { ... },
  "security": { ... },
  "opencode": { ... },
  "governance": { ... },
  "policy": { ... },
  "proactive": { ... },
  "onboarding": { ... },
  "heartbeat": { ... },
  "cli": { ... },
  "autoReply": { ... },
  "canvas": { ... },
  "mcp": { ... },
  "plugins": [ ... ],
  "cron": [ ... ],
  "logging": { ... }
}
```

All top-level sections are optional. An empty object `{}` is a valid configuration (all defaults will be applied).

### Validation

Validate your config file without starting the gateway:

```bash
iris config validate
iris config validate /path/to/config.json
```

View the resolved configuration (with tokens redacted):

```bash
iris config show
```

Config validation is powered by Zod schemas defined in `src/config/schema.ts`.

## Environment Variable Substitution

Config values can reference environment variables using the `${env:VAR_NAME}` syntax. This is the recommended way to handle secrets like bot tokens.

```json
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "enabled": true,
      "token": "${env:TELEGRAM_BOT_TOKEN}"
    }
  }
}
```

Rules:

- Variable names must match `[A-Z_][A-Z0-9_]*` (uppercase letters, digits, underscores).
- If a referenced variable is not set in the environment, Iris will throw an error at startup: `Missing environment variable: VAR_NAME`.
- Substitution happens before JSON parsing, so the syntax works in any string value.

Load environment variables using Node.js `--env-file` flag:

```bash
node --env-file=.env dist/index.js gateway run
```

## Gateway Config

Controls the HTTP server that serves health checks, readiness probes, and metrics.

```json
{
  "gateway": {
    "port": 19876,
    "hostname": "127.0.0.1"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | `19876` | HTTP server port |
| `hostname` | string | `"127.0.0.1"` | Bind address. Use `"0.0.0.0"` to listen on all interfaces. |

## Channels Config

The `channels` section is a map of channel IDs to their configuration. The key is a user-defined identifier (e.g., `"telegram"`, `"my-discord-bot"`) used throughout the system.

```json
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "enabled": true,
      "token": "${env:TELEGRAM_BOT_TOKEN}"
    },
    "work-slack": {
      "type": "slack",
      "enabled": true,
      "appToken": "${env:SLACK_APP_TOKEN}",
      "botToken": "${env:SLACK_BOT_TOKEN}"
    }
  }
}
```

### Common Channel Fields

These fields apply to all channel types:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | required | Channel type: `"telegram"`, `"whatsapp"`, `"discord"`, or `"slack"` |
| `enabled` | boolean | `false` | Whether this channel is active |
| `dmPolicy` | string | (uses global default) | Per-channel DM policy override: `"open"`, `"pairing"`, `"allowlist"`, or `"disabled"` |
| `groupPolicy` | object | (none) | Group message handling configuration (see below) |
| `mentionPattern` | string | (none) | Custom regex pattern for bot mention detection in groups |
| `maxTextLength` | number | (platform default) | Override the maximum text length for outgoing messages |

### Group Policy

Controls how the bot handles messages in group chats:

```json
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "enabled": true,
      "token": "${env:TELEGRAM_BOT_TOKEN}",
      "groupPolicy": {
        "enabled": true,
        "requireMention": true,
        "allowedCommands": ["/ask", "/help"]
      }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Whether to process group messages at all |
| `requireMention` | boolean | `true` | Only respond when the bot is mentioned |
| `allowedCommands` | string[] | (none) | Optional list of command prefixes the bot will respond to |

### Telegram

Telegram bots are created via [@BotFather](https://t.me/BotFather).

```json
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "enabled": true,
      "token": "${env:TELEGRAM_BOT_TOKEN}"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | Bot token from @BotFather |

The Telegram adapter is built on the [grammY](https://grammy.dev/) library.

### Discord

Discord bots are created via the [Discord Developer Portal](https://discord.com/developers/applications).

```json
{
  "channels": {
    "discord": {
      "type": "discord",
      "enabled": true,
      "token": "${env:DISCORD_BOT_TOKEN}"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | Bot token from Discord Developer Portal |

Required Discord bot settings:

- Enable "Message Content Intent" under Privileged Gateway Intents.
- Grant the bot `Send Messages`, `Read Message History`, and `Add Reactions` permissions.

The Discord adapter is built on [discord.js](https://discord.js.org/).

### WhatsApp

WhatsApp uses the [Baileys](https://github.com/WhiskeySockets/Baileys) library, which connects via the WhatsApp Web protocol. No separate token is needed -- authentication is done via QR code on first startup.

```json
{
  "channels": {
    "whatsapp": {
      "type": "whatsapp",
      "enabled": true
    }
  }
}
```

On first launch, a QR code will be printed to the terminal or logs. Scan it with WhatsApp on your phone to authenticate. The session is persisted in the state directory (`~/.iris`).

### Slack

Slack apps are created via the [Slack App Dashboard](https://api.slack.com/apps). Iris uses Socket Mode for real-time communication.

```json
{
  "channels": {
    "slack": {
      "type": "slack",
      "enabled": true,
      "appToken": "${env:SLACK_APP_TOKEN}",
      "botToken": "${env:SLACK_BOT_TOKEN}"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `appToken` | string | Yes | App-level token (starts with `xapp-`). Generated under "Basic Information" > "App-Level Tokens" with `connections:write` scope. |
| `botToken` | string | Yes | Bot user OAuth token (starts with `xoxb-`). Found under "OAuth & Permissions". |

Required Slack app settings:

- Enable Socket Mode.
- Subscribe to `message.im` and `message.channels` events under "Event Subscriptions".
- Add OAuth scopes: `chat:write`, `im:history`, `channels:history`.

The Slack adapter is built on [@slack/bolt](https://slack.dev/bolt-js/).

## Security Config

Controls the default DM access policy, pairing mechanism, and rate limiting.

```json
{
  "security": {
    "defaultDmPolicy": "pairing",
    "pairingCodeTtlMs": 3600000,
    "pairingCodeLength": 8,
    "rateLimitPerMinute": 30,
    "rateLimitPerHour": 300
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultDmPolicy` | string | `"pairing"` | Default DM policy for channels that do not specify one. Options: `"open"`, `"pairing"`, `"allowlist"`, `"disabled"`. |
| `pairingCodeTtlMs` | number | `3600000` (1 hour) | How long a pairing code remains valid, in milliseconds. |
| `pairingCodeLength` | number | `8` | Length of generated pairing codes (min: 4, max: 16). |
| `rateLimitPerMinute` | number | `30` | Maximum messages per minute per user per channel. |
| `rateLimitPerHour` | number | `300` | Maximum messages per hour per user per channel. |

### DM Policy Modes Explained

**`open`** -- No restrictions. Any user can message the bot and receive AI responses. Use this only in trusted environments.

**`pairing`** -- The default mode. When a new (unknown) user sends a message, they receive a pairing code. The gateway owner approves it from the command line:

```bash
# List pending codes
iris pairing list

# Approve a specific code
iris pairing approve ABCD1234
```

Once approved, the user is added to the allowlist permanently.

**`allowlist`** -- Only pre-approved users can interact. Add users manually:

```bash
iris security allowlist add telegram 123456789
iris security allowlist list telegram
```

**`disabled`** -- The channel rejects all DM messages with a "This channel is currently disabled" response.

Per-channel overrides take precedence over the global default. For example, you can run Telegram in `pairing` mode while keeping Discord in `allowlist` mode:

```json
{
  "security": {
    "defaultDmPolicy": "pairing"
  },
  "channels": {
    "telegram": {
      "type": "telegram",
      "enabled": true,
      "token": "${env:TELEGRAM_BOT_TOKEN}"
    },
    "discord": {
      "type": "discord",
      "enabled": true,
      "token": "${env:DISCORD_BOT_TOKEN}",
      "dmPolicy": "allowlist"
    }
  }
}
```

## OpenCode Config

Controls the connection to the OpenCode CLI server.

```json
{
  "opencode": {
    "port": 4096,
    "hostname": "127.0.0.1",
    "autoSpawn": true,
    "projectDir": "/home/user/my-project"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | `4096` | Port for the OpenCode server |
| `hostname` | string | `"127.0.0.1"` | Hostname for the OpenCode server |
| `autoSpawn` | boolean | `true` | If true, Iris spawns its own OpenCode server on startup. If false, it connects to an existing one. |
| `projectDir` | string | (none) | Working directory for OpenCode (the project it operates on) |

When `autoSpawn` is `true`, Iris uses the `@opencode-ai/sdk` to start an embedded OpenCode server. When `false`, it connects to a pre-existing OpenCode instance at `http://<hostname>:<port>`.

## Cron Config

Schedule recurring AI prompts that are delivered to a specific channel and chat. This is useful for automated reports, reminders, or periodic tasks.

```json
{
  "cron": [
    {
      "name": "daily-greeting",
      "schedule": "0 9 * * *",
      "prompt": "Send a friendly good morning message",
      "channel": "telegram",
      "chatId": "123456789"
    },
    {
      "name": "weekly-report",
      "schedule": "0 17 * * 5",
      "prompt": "Generate a summary of this week's git commits and open issues",
      "channel": "slack",
      "chatId": "C01234ABCDE"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for the cron job |
| `schedule` | string | Yes | Cron expression (standard 5-field format: minute hour day month weekday) |
| `prompt` | string | Yes | The AI prompt to execute on each trigger |
| `channel` | string | Yes | Channel ID (must match a key in `channels`) |
| `chatId` | string | Yes | Target chat/conversation ID to deliver the response |

Cron jobs can also be managed at runtime via the CLI:

```bash
iris cron list
iris cron add daily-report "0 9 * * *" "Generate status report" --channel telegram --chat-id 123
iris cron remove daily-report
```

The cron engine uses [croner](https://github.com/Hexagon/croner) for scheduling.

## Logging Config

Controls structured logging output via [pino](https://getpino.io/).

```json
{
  "logging": {
    "level": "info",
    "file": "/var/log/iris/gateway.log",
    "json": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | string | `"info"` | Minimum log level: `"debug"`, `"info"`, `"warn"`, or `"error"` |
| `file` | string | (none) | If set, write logs to this file path |
| `json` | boolean | (none) | If true, output logs in JSON format (useful for log aggregation) |

For human-readable output during development, pipe through `pino-pretty` (included as a dev dependency):

```bash
npm run dev 2>&1 | npx pino-pretty
```

## Governance Config

Behavioral rule engine. Rules are evaluated on every tool call via the `tool.execute.before` hook. Governance operates within the master policy ceiling -- it can restrict further but never widen.

```json
{
  "governance": {
    "enabled": true,
    "rules": [
      {
        "id": "rate-vault",
        "description": "Limit vault writes to 10 per minute",
        "tool": "vault_remember",
        "type": "rate_limit",
        "params": { "maxPerMinute": 10 }
      },
      {
        "id": "no-delete-groups",
        "description": "Block message deletion in group chats",
        "tool": "channel_action",
        "type": "constraint",
        "params": { "blockIf": { "action": "delete", "chatType": "group" } }
      }
    ],
    "directives": [
      "Always greet users in their detected language",
      "Never send more than 3 messages in a row without user interaction"
    ]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable governance rule evaluation |
| `rules` | array | `[]` | List of governance rules |
| `directives` | string[] | `[]` | Free-text behavioral directives injected into AI system prompt |

Each rule:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique rule identifier |
| `description` | string | No | Human-readable description |
| `tool` | string | Yes | Tool name this rule applies to (or `"*"` for all) |
| `type` | string | Yes | Rule type: `"rate_limit"`, `"constraint"`, `"custom"`, `"audit"` |
| `params` | object | No | Type-specific parameters |

## Policy Config

Master policy defines the structural ceiling for the entire system. What tools, permissions, and modes CAN exist. Config-driven, immutable at runtime. Every agent, skill, and tool call is validated against policy before governance.

```json
{
  "policy": {
    "enabled": true,
    "tools": {
      "allowed": ["send_message", "vault_search", "vault_remember"],
      "denied": ["rules_update"]
    },
    "permissions": {
      "bash": "deny",
      "edit": "deny",
      "read": "deny"
    },
    "agents": {
      "allowedModes": ["subagent"],
      "maxSteps": 25,
      "requireDescription": true,
      "defaultTools": ["vault_search", "skill"],
      "allowPrimaryCreation": false
    },
    "skills": {
      "restricted": ["moderation"],
      "requireTriggers": false
    },
    "enforcement": {
      "blockUnknownTools": true,
      "auditPolicyViolations": true
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable master policy enforcement |
| `tools.allowed` | string[] | `[]` | Tool allowlist. Empty = all allowed. |
| `tools.denied` | string[] | `[]` | Tool blocklist. Always denied regardless of allowlist. |
| `permissions.bash` | string | `"deny"` | Master permission for shell access |
| `permissions.edit` | string | `"deny"` | Master permission for file editing |
| `permissions.read` | string | `"deny"` | Master permission for file reading |
| `agents.allowedModes` | string[] | `["subagent"]` | Modes allowed for dynamically created agents |
| `agents.maxSteps` | number | `0` | Max tool-call steps per agent. 0 = no limit. |
| `agents.requireDescription` | boolean | `true` | Require description field on agent creation |
| `agents.defaultTools` | string[] | `["vault_search", "skill"]` | Tools every agent gets automatically |
| `agents.allowPrimaryCreation` | boolean | `false` | Allow creating primary-mode agents |
| `skills.restricted` | string[] | `[]` | Skills that cannot be assigned to dynamic agents |
| `skills.requireTriggers` | boolean | `false` | Warn if skill has no triggers |
| `enforcement.blockUnknownTools` | boolean | `true` | Block tool calls not in allowlist |
| `enforcement.auditPolicyViolations` | boolean | `true` | Log policy violations to audit trail |

## Proactive Config

Follow-up intelligence system. The AI registers intents to check back on users, and passive scans detect dormant users. All outreach respects quiet hours and soft quotas.

```json
{
  "proactive": {
    "enabled": true,
    "pollIntervalMs": 60000,
    "passiveScanIntervalMs": 21600000,
    "softQuotas": {
      "perUserPerDay": 3,
      "globalPerDay": 100
    },
    "dormancy": {
      "enabled": true,
      "thresholdMs": 604800000
    },
    "intentDefaults": {
      "minDelayMs": 3600000,
      "maxAgeMs": 604800000,
      "defaultConfidence": 0.8,
      "confidenceThreshold": 0.5
    },
    "quietHours": {
      "start": 22,
      "end": 8
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable proactive system |
| `pollIntervalMs` | number | `60000` | How often to check for due intents (ms) |
| `passiveScanIntervalMs` | number | `21600000` (6h) | How often to scan for dormant users (ms) |
| `softQuotas.perUserPerDay` | number | `3` | Max proactive messages per user per day |
| `softQuotas.globalPerDay` | number | `100` | Max proactive messages total per day |
| `dormancy.enabled` | boolean | `true` | Enable dormant user detection |
| `dormancy.thresholdMs` | number | `604800000` (7d) | Time since last message before user is considered dormant |
| `intentDefaults.minDelayMs` | number | `3600000` (1h) | Minimum delay before executing an intent |
| `intentDefaults.maxAgeMs` | number | `604800000` (7d) | Intents older than this are expired |
| `intentDefaults.defaultConfidence` | number | `0.8` | Default confidence for new intents |
| `intentDefaults.confidenceThreshold` | number | `0.5` | Minimum confidence to execute |
| `quietHours.start` | number | `22` | Hour (0-23) when quiet hours begin |
| `quietHours.end` | number | `8` | Hour (0-23) when quiet hours end |

## Onboarding Config

Two-layer user profiling. Layer 1 (statistical) runs on every message -- tinyld language detection for 62 languages, Unicode script classification, active hours tracking. Layer 2 (LLM-powered) happens through conversation -- the AI uses `enrich_profile` to store what it learns.

```json
{
  "onboarding": {
    "enabled": true,
    "enricher": {
      "enabled": true,
      "signalRetentionDays": 90,
      "consolidateIntervalMs": 3600000
    },
    "firstContact": {
      "enabled": true
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable onboarding subsystem |
| `enricher.enabled` | boolean | `true` | Enable statistical signal collection |
| `enricher.signalRetentionDays` | number | `90` | Days to retain raw signals before cleanup |
| `enricher.consolidateIntervalMs` | number | `3600000` (1h) | How often to consolidate signals into profiles |
| `firstContact.enabled` | boolean | `true` | Enable first-contact meta-prompt injection |

When `firstContact.enabled` is true, brand-new users receive a language-agnostic meta-prompt so the AI responds in their detected language from the first message.

## Heartbeat Config

Adaptive health monitoring with self-healing. Five checkers (bridge, channels, vault, sessions, memory) run on intervals that tighten as health degrades.

```json
{
  "heartbeat": {
    "enabled": true,
    "intervals": {
      "healthy": 60000,
      "degraded": 15000,
      "critical": 5000
    },
    "selfHeal": {
      "enabled": true,
      "maxAttempts": 3,
      "backoffTicks": 3
    },
    "activity": {
      "enabled": true,
      "dormancyThresholdMs": 604800000
    },
    "logRetentionDays": 30,
    "activeHours": {
      "start": "09:00",
      "end": "22:00",
      "timezone": "Europe/Chisinau"
    },
    "visibility": {
      "showOk": false,
      "showAlerts": true,
      "useIndicator": true
    },
    "dedupWindowMs": 86400000,
    "emptyCheck": {
      "enabled": true,
      "maxBackoffMs": 300000
    },
    "coalesceMs": 250,
    "retryMs": 1000,
    "agents": [
      {
        "agentId": "production",
        "activeHours": {
          "start": "06:00",
          "end": "23:00",
          "timezone": "Europe/Chisinau"
        }
      }
    ]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable heartbeat monitoring |
| `intervals.healthy` | number | `60000` | Check interval when all healthy (ms) |
| `intervals.degraded` | number | `15000` | Check interval when degraded (ms) |
| `intervals.critical` | number | `5000` | Check interval when critical (ms) |
| `selfHeal.enabled` | boolean | `true` | Enable automatic recovery attempts |
| `selfHeal.maxAttempts` | number | `3` | Max recovery attempts before giving up |
| `selfHeal.backoffTicks` | number | `3` | Ticks to wait between recovery attempts |
| `activity.enabled` | boolean | `true` | Track user activity for dormancy detection |
| `activity.dormancyThresholdMs` | number | `604800000` (7d) | Time before user considered dormant |
| `logRetentionDays` | number | `30` | Days to retain heartbeat logs |
| `activeHours.start` | string | (none) | Start of active hours (`"HH:MM"` format) |
| `activeHours.end` | string | (none) | End of active hours (`"HH:MM"` format) |
| `activeHours.timezone` | string | (none) | IANA timezone (e.g., `"Europe/Chisinau"`) |
| `visibility.showOk` | boolean | `false` | Show healthy status in channels |
| `visibility.showAlerts` | boolean | `true` | Show alert status in channels |
| `visibility.useIndicator` | boolean | `true` | Use status indicator icons |
| `channelVisibility` | object | (none) | Per-channel visibility overrides (same fields as `visibility`) |
| `dedupWindowMs` | number | `86400000` (24h) | Suppress duplicate alerts within this window |
| `emptyCheck.enabled` | boolean | `true` | Skip full check when all healthy and unchanged |
| `emptyCheck.maxBackoffMs` | number | `300000` (5min) | Max backoff for empty-check optimization |
| `coalesceMs` | number | `250` | Debounce rapid heartbeat requests (ms) |
| `retryMs` | number | `1000` | Delay before retry when AI queue is busy (ms) |
| `agents` | array | (none) | Per-agent overrides for intervals and active hours |

Each agent entry:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | Yes | Agent identifier (e.g., `"production"`, `"staging"`) |
| `intervals` | object | No | Override `healthy`/`degraded`/`critical` intervals |
| `activeHours` | object | No | Override active hours window for this agent |

## CLI Config

Sandboxed integration with local CLI binaries. Config-driven: declare a binary, its subcommands, and which arguments each action accepts. The executor validates against a whitelist before spawning (`execFile`, not `exec` -- no shell injection). Always appends `--json --no-input`.

```json
{
  "cli": {
    "enabled": true,
    "timeout": 10000,
    "sandbox": {
      "allowedBinaries": ["gog"]
    },
    "tools": {
      "google_calendar": {
        "binary": "gog",
        "description": "Manage Google Calendar events and calendars",
        "actions": {
          "list_calendars": {
            "subcommand": ["calendar", "calendars"]
          },
          "list_events": {
            "subcommand": ["calendar", "events"],
            "positional": ["calendarId"]
          },
          "create_event": {
            "subcommand": ["calendar", "create"],
            "positional": ["calendarId"],
            "flags": ["summary", "start", "end", "description", "location"]
          }
        }
      }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable CLI tool subsystem |
| `timeout` | number | `10000` | Command execution timeout (ms) |
| `sandbox.allowedBinaries` | string[] | `[]` | Whitelist of binary names. Resolved to absolute paths at startup. |
| `tools` | object | `{}` | Map of tool name to tool definition |

Each tool definition:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `binary` | string | Yes | Binary name (must be in `sandbox.allowedBinaries`) |
| `description` | string | Yes | Human-readable tool description (shown to AI) |
| `actions` | object | Yes | Map of action name to action definition |

Each action definition:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subcommand` | string[] | Yes | CLI subcommand path (e.g., `["calendar", "create"]`) |
| `positional` | string[] | No | Positional argument names, in order |
| `flags` | string[] | No | Named flag arguments (passed as `--flag=value`) |

The executor builds: `[binary, ...subcommand, ...positionalValues, ...flagArgs, "--json", "--no-input"]`. Undeclared flags are silently ignored (security by design). On startup, a manifest is written to `~/.iris/cli-tools.json` for the OpenCode plugin to auto-register tools.

## Auto-Reply Config

Template-based auto-reply engine. Matches inbound messages against templates before routing to the AI. Matched messages get an instant response with zero AI cost.

```json
{
  "autoReply": {
    "enabled": true,
    "templates": [
      {
        "id": "greeting",
        "trigger": { "type": "keyword", "words": ["hello", "hi", "hey"] },
        "response": "Hello! How can I help you?",
        "priority": 10,
        "cooldown": 60
      },
      {
        "id": "office-hours",
        "trigger": {
          "type": "schedule",
          "when": { "hours": [0, 8], "days": [0, 6] }
        },
        "response": "Outside office hours. Will respond when available.",
        "forwardToAi": false
      },
      {
        "id": "help-command",
        "trigger": { "type": "command", "name": "help" },
        "response": "Available commands: /help, /status, /feedback"
      }
    ]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable auto-reply engine |
| `templates` | array | `[]` | List of auto-reply templates |

Each template:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique template identifier |
| `trigger.type` | string | Yes | Match type: `"exact"`, `"regex"`, `"keyword"`, `"command"`, `"schedule"` |
| `trigger.pattern` | string | No | Pattern for `exact` or `regex` triggers |
| `trigger.words` | string[] | No | Keywords for `keyword` trigger (any match fires) |
| `trigger.name` | string | No | Command name for `command` trigger |
| `trigger.when` | object | No | Time window for `schedule` trigger |
| `trigger.when.hours` | [number, number] | No | Hour range `[start, end]` (0-23) |
| `trigger.when.days` | number[] | No | Days of week (0=Sunday, 6=Saturday) |
| `response` | string | Yes | Response text to send |
| `priority` | number | No | Higher priority templates match first |
| `cooldown` | number | No | Seconds before same template can fire again for same user |
| `once` | boolean | No | If true, template fires only once per user |
| `channels` | string[] | No | Restrict to specific channel IDs |
| `chatTypes` | string[] | No | Restrict to `"dm"` and/or `"group"` |
| `forwardToAi` | boolean | No | If true, forward to AI after auto-reply |

## Canvas Config

WebSocket-based A2UI dashboard. The AI pushes rich UI components (charts, tables, forms, code blocks, progress bars) to connected clients.

```json
{
  "canvas": {
    "enabled": true,
    "port": 19880,
    "hostname": "127.0.0.1"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Canvas UI server |
| `port` | number | `19880` | WebSocket server port |
| `hostname` | string | `"127.0.0.1"` | Bind address |

## MCP Config

Model Context Protocol server toggles. MCP and CLI tool integration coexist -- CLI is the base layer, MCP is supplemental.

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": { "enabled": true },
      "web-search": { "enabled": false }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable MCP server integration |
| `servers` | object | `{}` | Map of server name to `{ enabled: boolean }` |

## Plugins Config

Plugin auto-discovery paths. Iris scans these directories for plugins on startup. Each plugin is security-scanned before loading.

```json
{
  "plugins": [
    "./plugins/",
    "~/.iris/plugins/"
  ]
}
```

The `plugins` field is an optional array of directory paths. Defaults to `./plugins/` and `~/.iris/plugins/` when omitted.

## Streaming Config

Per-channel response streaming. When enabled, the AI's response is delivered incrementally instead of waiting for completion. Configured per-channel inside the channel definition.

```json
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "enabled": true,
      "token": "${env:TELEGRAM_BOT_TOKEN}",
      "streaming": {
        "enabled": true,
        "minChars": 100,
        "maxChars": 2000,
        "idleMs": 1500,
        "breakOn": "paragraph",
        "editInPlace": true
      }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable streaming for this channel |
| `minChars` | number | (none) | Minimum characters before first delivery |
| `maxChars` | number | (none) | Maximum characters per delivery chunk |
| `idleMs` | number | (none) | Idle time (ms) before flushing partial chunk |
| `breakOn` | string | (none) | Break delivery on: `"paragraph"`, `"sentence"`, `"word"` |
| `editInPlace` | boolean | (none) | Edit the previous message instead of sending new ones |

## State Directory

Iris persists runtime state (sessions, allowlists, pairing codes, vault, heartbeat logs, proactive intents) in a state directory. The default location is `~/.iris`.

Override with the `IRIS_STATE_DIR` environment variable:

```bash
export IRIS_STATE_DIR=/var/lib/iris
```

The state directory is created automatically if it does not exist. Contents:

| File | Purpose |
|------|---------|
| `vault.db` | SQLite database (memories, profiles, signals, audit, governance, usage, heartbeat) |
| `sessions/` | Per-channel session state |
| `allowlists/` | Per-channel sender allowlists |
| `pairing/` | Pending pairing codes |
| `cli-tools.json` | CLI tool manifest (auto-generated, read by plugin) |
| `plugin-tools.json` | Plugin tool manifest (auto-generated, read by plugin) |

## Complete Example

Below is a configuration file using all available sections:

```json
{
  "gateway": {
    "port": 19876,
    "hostname": "127.0.0.1"
  },
  "opencode": {
    "port": 4096,
    "hostname": "127.0.0.1",
    "autoSpawn": true,
    "projectDir": "/home/user/my-project"
  },
  "security": {
    "defaultDmPolicy": "pairing",
    "pairingCodeTtlMs": 3600000,
    "pairingCodeLength": 8,
    "rateLimitPerMinute": 30,
    "rateLimitPerHour": 300
  },
  "channels": {
    "telegram": {
      "type": "telegram",
      "enabled": true,
      "token": "${env:TELEGRAM_BOT_TOKEN}",
      "groupPolicy": {
        "enabled": true,
        "requireMention": true
      },
      "streaming": {
        "enabled": true,
        "breakOn": "paragraph",
        "editInPlace": true
      }
    },
    "whatsapp": {
      "type": "whatsapp",
      "enabled": true,
      "dmPolicy": "allowlist"
    },
    "discord": {
      "type": "discord",
      "enabled": true,
      "token": "${env:DISCORD_BOT_TOKEN}",
      "dmPolicy": "open",
      "groupPolicy": {
        "enabled": true,
        "requireMention": true,
        "allowedCommands": ["/ask", "/summarize"]
      }
    },
    "slack": {
      "type": "slack",
      "enabled": true,
      "appToken": "${env:SLACK_APP_TOKEN}",
      "botToken": "${env:SLACK_BOT_TOKEN}"
    }
  },
  "governance": {
    "enabled": true,
    "rules": [
      {
        "id": "rate-vault",
        "description": "Limit vault writes",
        "tool": "vault_remember",
        "type": "rate_limit",
        "params": { "maxPerMinute": 10 }
      }
    ],
    "directives": [
      "Respond in the user's detected language"
    ]
  },
  "policy": {
    "enabled": true,
    "tools": { "allowed": [], "denied": ["rules_update"] },
    "permissions": { "bash": "deny", "edit": "deny", "read": "deny" },
    "agents": {
      "allowedModes": ["subagent"],
      "maxSteps": 25,
      "requireDescription": true,
      "defaultTools": ["vault_search", "skill"],
      "allowPrimaryCreation": false
    },
    "skills": { "restricted": [], "requireTriggers": false },
    "enforcement": { "blockUnknownTools": true, "auditPolicyViolations": true }
  },
  "proactive": {
    "enabled": true,
    "pollIntervalMs": 60000,
    "passiveScanIntervalMs": 21600000,
    "softQuotas": { "perUserPerDay": 3, "globalPerDay": 100 },
    "dormancy": { "enabled": true, "thresholdMs": 604800000 },
    "intentDefaults": {
      "minDelayMs": 3600000,
      "maxAgeMs": 604800000,
      "defaultConfidence": 0.8,
      "confidenceThreshold": 0.5
    },
    "quietHours": { "start": 22, "end": 8 }
  },
  "onboarding": {
    "enabled": true,
    "enricher": {
      "enabled": true,
      "signalRetentionDays": 90,
      "consolidateIntervalMs": 3600000
    },
    "firstContact": { "enabled": true }
  },
  "heartbeat": {
    "enabled": true,
    "intervals": { "healthy": 60000, "degraded": 15000, "critical": 5000 },
    "selfHeal": { "enabled": true, "maxAttempts": 3, "backoffTicks": 3 },
    "activity": { "enabled": true, "dormancyThresholdMs": 604800000 },
    "logRetentionDays": 30,
    "activeHours": { "start": "09:00", "end": "22:00", "timezone": "Europe/Chisinau" },
    "dedupWindowMs": 86400000,
    "emptyCheck": { "enabled": true, "maxBackoffMs": 300000 },
    "agents": [
      { "agentId": "production" }
    ]
  },
  "cli": {
    "enabled": true,
    "timeout": 10000,
    "sandbox": { "allowedBinaries": ["gog"] },
    "tools": {
      "google_calendar": {
        "binary": "gog",
        "description": "Manage Google Calendar",
        "actions": {
          "list_calendars": { "subcommand": ["calendar", "calendars"] },
          "list_events": { "subcommand": ["calendar", "events"], "positional": ["calendarId"] },
          "create_event": {
            "subcommand": ["calendar", "create"],
            "positional": ["calendarId"],
            "flags": ["summary", "start", "end", "description", "location"]
          }
        }
      }
    }
  },
  "autoReply": {
    "enabled": true,
    "templates": [
      {
        "id": "greeting",
        "trigger": { "type": "keyword", "words": ["hello", "hi"] },
        "response": "Hello! How can I help?",
        "cooldown": 60
      }
    ]
  },
  "canvas": {
    "enabled": false,
    "port": 19880,
    "hostname": "127.0.0.1"
  },
  "mcp": {
    "enabled": false,
    "servers": {}
  },
  "cron": [
    {
      "name": "daily-greeting",
      "schedule": "0 9 * * *",
      "prompt": "Send a friendly good morning message",
      "channel": "telegram",
      "chatId": "123456789"
    }
  ],
  "logging": {
    "level": "info",
    "json": true
  }
}
```
