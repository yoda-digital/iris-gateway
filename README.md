# Iris

Multi-channel AI messaging gateway. Connects Telegram, WhatsApp, Discord, and Slack to [OpenCode CLI](https://github.com/nicholasgriffintn/opencode) with free models via OpenRouter.

## Requirements

- Node.js >= 22
- pnpm
- OpenCode CLI (auto-spawned or external)
- At least one bot token (Telegram, Discord, Slack) or WhatsApp QR auth

## Build

```
git clone https://github.com/yoda-digital/iris-gateway.git iris && cd iris
pnpm install
pnpm run build
pnpm test              # 338 tests, all must pass
```

## Configure

```
cp iris.config.example.json iris.config.json
```

Set tokens in environment or `.env`:

```
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
```

Tokens are referenced in config as `${env:TELEGRAM_BOT_TOKEN}`. See `iris.config.example.json` for the full schema including governance rules and MCP server settings.

Config sections:

| Section | What it does |
|---------|-------------|
| `gateway` | Health server port/host (default :19876) |
| `channels` | Per-channel adapter config (type, token, policies) |
| `security` | DM policy mode, pairing TTL, rate limits |
| `opencode` | OpenCode server port, auto-spawn toggle |
| `cron` | Scheduled prompts delivered to channels |
| `governance` | Rule engine: constraints, rate limits, audit, directives |
| `mcp` | MCP server toggles (sequential-thinking, tavily) |
| `logging` | Log level |

## Run

```
pnpm run dev            # development (tsx + hot reload)
pnpm run build && pnpm start  # production
```

Health check: `curl http://127.0.0.1:19876/health`

## Architecture

```
 Telegram --+
 WhatsApp --+                 +------------+
 Discord  --+-- Adapters --> Router --> OpenCode --> AI Model
 Slack    --+      |           |         Bridge
                   v           v           |
               Security     Session      Plugin
               Gate         Map        (9 tools, 6 hooks)
                                         |
                              +----------+----------+
                              |          |          |
                            Vault    Governance   Audit
                          (SQLite)    Engine       Log
```

Inbound: platform message -> adapter normalize -> security check -> session resolve -> OpenCode prompt -> SSE response -> chunk -> deliver back.

The OpenCode plugin (`.opencode/plugin/iris.ts`) consolidates all tools and hooks into a single file. Tools call back to the Iris process via HTTP IPC. This is architecturally necessary because `opencode serve` runs as a child process.

### Plugin: tools and hooks

9 tools registered in the plugin:

| Tool | Purpose |
|------|---------|
| `send_message` | Send text to a channel |
| `send_media` | Send media (image/video/audio/doc) |
| `channel_action` | Typing indicator, react, edit, delete |
| `user_info` | Query user capabilities |
| `list_channels` | List active channels |
| `vault_search` | FTS5 search across memories |
| `vault_remember` | Store a fact/preference/insight |
| `vault_forget` | Delete a memory by ID |
| `governance_status` | Show current rules and directives |

6 hooks:

| Hook | Purpose |
|------|---------|
| `tool.execute.before` | Governance rule validation before every tool call |
| `tool.execute.after` | Audit logging after every tool call |
| `chat.message` | Context injection (user profile + relevant memories) |
| `experimental.session.compacting` | Extract insights from conversation, store in vault |
| `experimental.chat.system.transform` | Inject directives and channel rules into system prompt |
| `permission.ask` | Deny file/bash permissions |

### Memory vault

SQLite database at `~/.iris/vault.db`. FTS5 full-text search on memory content. Tables: `memories`, `memories_fts`, `profiles`, `audit_log`, `governance_log`.

The `chat.message` hook auto-injects user profile and relevant memories into every conversation. The `session.compacting` hook extracts new facts when context gets large.

### Governance

Configurable rule engine. Rule types: `constraint` (field validation), `rate_limit` (per-session throttling), `audit` (logging), `custom` (reserved). Directives (D1-D4) injected into system prompt via hook. Enforced at runtime, not just advisory.

### MCP servers

Configured in `.opencode/opencode.json`. Currently: `sequential-thinking` (local, free). Tavily web search available when `TAVILY_API_KEY` is set.

## Security

Four DM policy modes per channel:

| Mode | Behavior |
|------|----------|
| `open` | Anyone can talk |
| `pairing` | New users get a code, owner approves via `iris pairing approve <code>` (default) |
| `allowlist` | Pre-approved senders only |
| `disabled` | Channel rejects all DMs |

Rate limiting: 30/min, 300/hr per user per channel (configurable).

Groups: optional mention-gating (`requireMention: true`).

## CLI

```
iris gateway run [--config path]    Start the gateway
iris doctor                         Diagnostic checks
iris status                         Gateway status
iris pairing list|approve|revoke    Manage pairing codes
iris session list|reset             Manage sessions
iris config show|validate           Configuration
iris security allowlist list|add    Allowlist management
iris cron list|add|remove           Scheduled jobs
iris send <channel> <to> <text>     One-shot message
```

## Project structure

```
src/
  index.ts             Entry point
  config/              Config loading, zod schema, types
  channels/            Channel adapters
    adapter.ts         ChannelAdapter interface
    registry.ts        Runtime registry
    telegram/          grammy
    whatsapp/          baileys
    discord/           discord.js
    slack/             @slack/bolt
  bridge/              OpenCode integration
    opencode-client.ts SDK wrapper (spawn + connect)
    session-map.ts     Channel user -> OpenCode session
    message-router.ts  Inbound/outbound routing
    event-handler.ts   SSE stream processing
    tool-server.ts     HTTP endpoints for plugin callbacks
    message-queue.ts   Delivery queue with retry
  vault/               Persistent memory (SQLite + FTS5)
    db.ts              Connection, schema migration
    store.ts           CRUD for memories, profiles, audit, governance log
    search.ts          FTS5 full-text search
    types.ts           Memory, UserProfile, AuditEntry types
  governance/          Rule engine
    engine.ts          Evaluate rules against tool calls
    types.ts           GovernanceRule, GovernanceConfig, EvaluationResult
  security/            DM policy, pairing, allowlist, rate limiter
  gateway/             Lifecycle orchestration, health server
  cron/                Scheduled jobs
  media/               Image/audio processing (sharp)
  cli/                 CLI commands (clipanion)
  logging/             Structured logging (pino)
  utils/               Shared utilities

.opencode/
  plugin/iris.ts       THE plugin (9 tools + 6 hooks)
  opencode.json        Model config, MCP servers, permissions
  agents/chat.md       Primary agent system prompt
  skills/              greeting, help, moderation, onboarding, summarize, web-search

test/
  unit/                41 test files, 338 tests
  integration/         Pipeline tests
```

## Docker

```
docker build -t iris .
docker run -d --name iris --env-file .env -v iris-state:/root/.iris -p 19876:19876 iris
```

## License

MIT
