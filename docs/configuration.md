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
  "cron": [ ... ],
  "logging": { ... }
}
```

An empty object `{}` is a valid configuration (all defaults will be applied).

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

## State Directory

Iris persists runtime state (sessions, allowlists, pairing codes, cron state) in a state directory. The default location is `~/.iris`.

Override with the `IRIS_STATE_DIR` environment variable:

```bash
export IRIS_STATE_DIR=/var/lib/iris
```

The state directory is created automatically if it does not exist.

## Complete Example

Below is a complete configuration file using all available options:

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
