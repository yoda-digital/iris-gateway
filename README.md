# Iris

A multi-channel AI messaging gateway that connects Telegram, WhatsApp, Discord, and Slack to [OpenCode CLI](https://github.com/nicholasgriffintn/opencode). Send a message from any supported platform and get an AI-powered response routed through OpenCode.

## Features

- **Multi-channel support** -- Telegram, WhatsApp, Discord, and Slack adapters with a unified interface
- **Security model** -- Four DM policy modes (open, pairing, allowlist, disabled), per-channel overrides, and rate limiting
- **Session management** -- Persistent session mapping between chat threads and OpenCode sessions
- **Cron jobs** -- Schedule recurring AI prompts delivered to any channel
- **Health and metrics** -- Built-in HTTP endpoints for health checks, readiness probes, and Prometheus-compatible metrics
- **Environment variable substitution** -- Reference secrets with `${env:VAR}` syntax in config files
- **Graceful lifecycle** -- Clean startup sequencing, SSE reconnection with backoff, and orderly shutdown
- **Media support** -- Image, video, audio, and document handling across channels (where supported)
- **Message chunking** -- Automatic splitting of long responses to respect platform character limits
- **CLI tooling** -- Full command-line interface for administration, diagnostics, and one-shot messaging

## Quick Start

### Prerequisites

- Node.js >= 22
- An [OpenCode](https://github.com/nicholasgriffintn/opencode) installation (Iris can auto-spawn it)
- At least one bot token for a supported platform (Telegram, Discord, Slack, or WhatsApp)

### Install

```bash
git clone <repo-url> iris
cd iris
npm install
```

### Configure

1. Copy the example config and environment files:

```bash
cp iris.config.example.json iris.config.json
cp .env.example .env
```

2. Edit `.env` and fill in your bot tokens:

```dotenv
TELEGRAM_BOT_TOKEN=your-telegram-token
DISCORD_BOT_TOKEN=your-discord-token
SLACK_APP_TOKEN=xapp-your-slack-app-token
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
```

3. Edit `iris.config.json` to enable the channels you want. Tokens are referenced from environment variables using `${env:VAR}` syntax:

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

### Run

Development (with hot reload):

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

Or directly:

```bash
node --env-file=.env dist/index.js gateway run
```

### Verify

Run the built-in diagnostics:

```bash
iris doctor
```

Check gateway health:

```bash
curl http://127.0.0.1:19876/health
```

## Architecture

```
 Telegram ──┐
 WhatsApp ──┤                    ┌──────────────┐
 Discord  ──┼── Channel ──> Message   ──> OpenCode ──> AI
 Slack    ──┤   Adapters    Router       Bridge       Model
            │       │          │
            │       v          v
            │   Security    Session
            │   Gate        Map
            │
            └── Health Server (HTTP)
                 /health
                 /ready
                 /metrics
                 /channels
```

**Data flow:**

1. A user sends a message on a supported platform (Telegram, WhatsApp, Discord, or Slack).
2. The corresponding **Channel Adapter** normalizes the message into a unified `InboundMessage` format.
3. The **Security Gate** checks DM policy (open/pairing/allowlist/disabled) and rate limits.
4. The **Message Router** resolves or creates an OpenCode session via the **Session Map**.
5. The message is forwarded to the **OpenCode Bridge**, which sends it to the OpenCode server.
6. OpenCode processes the message through the configured AI model and emits a response via SSE.
7. The **Event Handler** receives the SSE event and passes the response text back to the Message Router.
8. The router chunks the response (if needed) and delivers it back through the originating Channel Adapter.

**Startup sequence** (see `src/gateway/lifecycle.ts`):

1. Load and validate configuration
2. Create logger
3. Ensure state directory (`~/.iris`)
4. Start OpenCode bridge (auto-spawn or connect to existing)
5. Initialize security components (pairing store, allowlist, rate limiter)
6. Create session map
7. Create channel registry and message cache
8. Create message router
9. Start tool server
10. Start health server
11. Register and start enabled channel adapters
12. Subscribe to OpenCode SSE events (with automatic reconnection)
13. Register graceful shutdown handlers (SIGTERM, SIGINT)

## Configuration Reference

The configuration file is `iris.config.json` by default (override with `IRIS_CONFIG_PATH` env var or `--config` flag). All sections have sensible defaults; an empty `{}` is a valid config.

See [docs/configuration.md](docs/configuration.md) for the full reference.

### Summary of Config Sections

| Section | Description |
|---------|-------------|
| `gateway` | HTTP server port and hostname for health/metrics endpoints |
| `channels` | Per-channel adapter configuration (type, tokens, policies) |
| `security` | Default DM policy, pairing settings, rate limits |
| `opencode` | OpenCode server connection and auto-spawn settings |
| `cron` | Scheduled prompts delivered to channels |
| `logging` | Log level, file output, JSON format |

### Example Configuration

```json
{
  "gateway": {
    "port": 19876,
    "hostname": "127.0.0.1"
  },
  "opencode": {
    "port": 4096,
    "hostname": "127.0.0.1",
    "autoSpawn": true
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
      "token": "${env:TELEGRAM_BOT_TOKEN}"
    }
  },
  "logging": {
    "level": "info"
  }
}
```

## CLI Commands

Iris provides a full CLI built with [Clipanion](https://github.com/arcanis/clipanion). Run `iris --help` for usage.

### Gateway

| Command | Description |
|---------|-------------|
| `iris gateway run` | Start the Iris messaging gateway (also the default command) |
| `iris gateway run --config <path>` | Start with a custom config file |

### Status and Diagnostics

| Command | Description |
|---------|-------------|
| `iris status` | Show gateway status and diagnostics |
| `iris doctor` | Run diagnostic checks on configuration and environment |

### Pairing

| Command | Description |
|---------|-------------|
| `iris pairing list` | List pending pairing requests |
| `iris pairing approve <code>` | Approve a pairing code and add the sender to the allowlist |
| `iris pairing revoke <code>` | Revoke a pending pairing code |

### Sessions

| Command | Description |
|---------|-------------|
| `iris session list` | List all session mappings |
| `iris session reset <key>` | Reset a specific session mapping (key format: `channel:chatType:chatId`) |

### Configuration

| Command | Description |
|---------|-------------|
| `iris config show` | Show current configuration (tokens redacted) |
| `iris config validate [path]` | Validate a configuration file |

### Security

| Command | Description |
|---------|-------------|
| `iris security allowlist list <channel>` | Show the allowlist for a specific channel |
| `iris security allowlist add <channel> <senderId>` | Add a sender to a channel's allowlist |

### Cron Jobs

| Command | Description |
|---------|-------------|
| `iris cron list` | List scheduled cron jobs |
| `iris cron add <name> <schedule> <prompt> --channel <ch> --chat-id <id>` | Add a new cron job |
| `iris cron remove <name>` | Remove a cron job |

### Messaging

| Command | Description |
|---------|-------------|
| `iris send <channel> <target> <message>` | Send a one-shot message to a channel target (for testing/automation) |

## Security Model

Iris implements a layered security model to control who can interact with the AI through messaging channels.

### DM Policy Modes

Each channel can use one of four DM policy modes (set globally via `security.defaultDmPolicy` or per-channel via `channels.<name>.dmPolicy`):

| Mode | Behavior |
|------|----------|
| `open` | Anyone can send messages. No authentication required. |
| `pairing` | New users receive a pairing code. The owner approves it via `iris pairing approve <code>`, which adds the user to the allowlist. This is the default. |
| `allowlist` | Only pre-approved users can send messages. Users must be added manually via `iris security allowlist add`. |
| `disabled` | The channel rejects all DM messages. |

### Pairing Flow

1. A new user sends a DM to the bot.
2. Iris generates a pairing code (configurable length, default 8 characters) and sends it back to the user.
3. The gateway owner runs `iris pairing approve <code>` on the server.
4. The user is added to the allowlist and can now communicate freely.
5. Pairing codes expire after a configurable TTL (default: 1 hour).

### Rate Limiting

All messages (except in `disabled` mode) are subject to rate limiting:

- **Per-minute limit**: Default 30 messages per minute per user per channel.
- **Per-hour limit**: Default 300 messages per hour per user per channel.

### Group Policy

Group messages can be gated with the `groupPolicy` configuration:

- `enabled`: Whether group messages are processed at all.
- `requireMention`: If true, the bot only responds when mentioned (default: true).
- `allowedCommands`: Optional list of allowed command prefixes.

## Docker Deployment

See [docs/deployment.md](docs/deployment.md) for full deployment instructions, including Docker setup, reverse proxy configuration, and monitoring.

### Quick Docker Setup

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY iris.config.json ./
EXPOSE 19876
CMD ["node", "--env-file=.env", "dist/index.js", "gateway", "run"]
```

```bash
docker build -t iris .
docker run -d \
  --name iris \
  --env-file .env \
  -v iris-state:/root/.iris \
  -p 19876:19876 \
  iris
```

## Development

### Setup

```bash
git clone <repo-url> iris
cd iris
npm install
```

### Run in Development

```bash
npm run dev
```

This uses `tsx` for TypeScript execution with hot reload and loads environment variables from `.env`.

### Build

```bash
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

### Test

```bash
npm test            # Run tests once
npm run test:watch  # Run tests in watch mode
```

### Lint

```bash
npm run lint        # TypeScript type checking (tsc --noEmit)
```

### Project Structure

```
src/
  index.ts              Entry point
  config/               Configuration loading, schema validation, paths
  channels/             Channel adapters (telegram, whatsapp, discord, slack)
    adapter.ts          Unified ChannelAdapter interface
    registry.ts         Runtime adapter registry
    telegram/           Telegram adapter (grammy)
    whatsapp/           WhatsApp adapter (baileys)
    discord/            Discord adapter (discord.js)
    slack/              Slack adapter (@slack/bolt)
  bridge/               OpenCode integration
    opencode-client.ts  OpenCode SDK wrapper
    session-map.ts      Channel-to-OpenCode session mapping
    message-router.ts   Inbound/outbound message routing
    event-handler.ts    SSE event processing
    tool-server.ts      MCP tool server for channel operations
    message-queue.ts    Outbound message queue with retry
  security/             Security subsystem
    dm-policy.ts        DM policy enforcement (SecurityGate)
    pairing-store.ts    Pairing code generation and storage
    allowlist-store.ts  Per-channel allowlist persistence
    rate-limiter.ts     Sliding-window rate limiter
  gateway/              Gateway lifecycle and HTTP server
    lifecycle.ts        Startup/shutdown orchestration
    health.ts           Health, readiness, metrics endpoints
  cron/                 Scheduled job management
  cli/                  CLI commands (clipanion)
  logging/              Structured logging (pino)
  media/                Media processing (sharp)
  utils/                Shared utilities
```

## License

MIT
