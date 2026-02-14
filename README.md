# Iris

Multi-channel AI messaging gateway. Routes messages between Telegram, WhatsApp, Discord, Slack, and WebChat through [OpenCode CLI](https://github.com/nicholasgriffintn/opencode) with free models via OpenRouter.

Learns users invisibly. Monitors its own health. Heals itself. Manages your calendar, email, contacts, and tasks through sandboxed CLI tools.

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
pnpm test
```

503 tests across 70 test files. 6 known failures in pipeline/message-router mocks -- unrelated to functionality.

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

Tokens are referenced in config as `${env:TELEGRAM_BOT_TOKEN}`. See `docs/configuration.md` for the full reference.

Config sections:

| Section | Purpose |
|---------|---------|
| `gateway` | Health server port/host (default :19876) |
| `channels` | Per-channel adapter config (type, token, DM/group policies, streaming) |
| `security` | DM policy mode, pairing TTL, rate limits |
| `opencode` | OpenCode server port, auto-spawn toggle |
| `cron` | Scheduled prompts delivered to channels |
| `governance` | Behavioral rule engine: constraints, rate limits, audit, directives |
| `policy` | Master policy: tool allowlists, permission ceiling, agent restrictions |
| `proactive` | Follow-up intents, dormancy detection, quiet hours |
| `onboarding` | Two-layer user profiling (statistical + LLM) |
| `heartbeat` | Health monitoring with self-healing, multi-agent, active hours gating |
| `cli` | Sandboxed CLI tool integration (gog for Google services, extensible) |
| `plugins` | Plugin paths (auto-discovered from `./plugins/` and `~/.iris/plugins/`) |
| `autoReply` | Template-based auto-reply engine (bypass AI for common queries) |
| `canvas` | Canvas UI server (WebSocket-based A2UI dashboard) |
| `mcp` | MCP server toggles |
| `logging` | Log level, file output, JSON mode |

## Run

```
pnpm run dev            # development (tsx + hot reload)
pnpm run build && pnpm start  # production
```

Health check: `curl http://127.0.0.1:19876/health`

## Architecture

Two cooperating processes connected via HTTP IPC:

1. **Iris Gateway** (Node.js) -- manages channels, security, vault, governance, tool server on port 19877.
2. **OpenCode CLI** (AI backend) -- auto-spawned or external on port 4096. Single plugin gives AI access to all Iris tools via HTTP callbacks.

```
 Telegram --+
 WhatsApp --+                                         +------------+
 Discord  --+-- Adapters --> Auto-Reply --> Router --> | OpenCode   |--> AI Model
 Slack    --+      |          Engine        |         | Bridge     |
 WebChat  --+      v                        v         |            |
               Security              Stream           | Plugin SDK |
               Gate                  Coalescer        | (30 tools) |
                                                      +------+-----+
                              +--------+--------+--------+---+---+--------+
                              |        |        |        |       |        |
                           Vault    Policy   Govern.  Proact.  Heart.   CLI
                         (SQLite)  Engine    Engine   Engine   Engine   Exec.
                                                                        |
                                                               gog, bird, ...
```

Inbound: platform message -> adapter normalize -> security check -> auto-reply check -> onboarding enrichment -> session resolve -> OpenCode prompt -> streaming coalesce -> deliver.

### Two-process boundary

The AI calls tools -> plugin makes HTTP POST to `http://127.0.0.1:19877/tool/*` -> Iris executes and returns. The OpenCode plugin (`.opencode/plugin/iris.ts`) consolidates all tools and hooks into a single file. Dynamic plugin tools registered from `~/.iris/plugin-tools.json`. CLI tools registered from `~/.iris/cli-tools.json`.

### Tools

30 built-in tools registered in the plugin:

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
| `governance_status` | Current rules and directives |
| `usage_summary` | Usage and cost tracking per user/period |
| `skill_create` | Create OpenCode skills dynamically |
| `skill_list` | List available skills |
| `skill_delete` | Delete a skill by name |
| `skill_validate` | Validate skill against spec |
| `agent_create` | Create OpenCode agents dynamically |
| `agent_list` | List available agents |
| `agent_delete` | Delete an agent by name |
| `agent_validate` | Validate agent against spec |
| `canvas_update` | Update Canvas UI with rich components |
| `rules_read` | Read AGENTS.md |
| `rules_update` | Replace AGENTS.md |
| `rules_append` | Append to AGENTS.md |
| `tools_list` | List custom tools |
| `tools_create` | Scaffold new TypeScript tool |
| `policy_status` | View master policy config |
| `policy_audit` | Audit agents/skills against policy |
| `proactive_intent` | Register follow-up intent |
| `proactive_cancel` | Cancel pending intent |
| `proactive_list` | List pending intents |
| `enrich_profile` | Store learned user attribute |
| `heartbeat_status` | Check system health across agents |
| `heartbeat_trigger` | Force immediate health check |
| `google_calendar` | Manage Calendar (via gog CLI) |
| `google_email` | Search/manage Gmail (via gog CLI) |
| `google_contacts` | Manage Contacts (via gog CLI) |
| `google_tasks` | Manage Tasks (via gog CLI) |
| `google_drive` | Browse/search Drive (via gog CLI) |

Plus `proactive_quota`, `proactive_scan`, `proactive_execute`, `proactive_engage` for the proactive system.

### Hooks

| Hook | Purpose |
|------|---------|
| `tool.execute.before` | Policy + governance validation before every tool call |
| `tool.execute.after` | Audit logging after every tool call |
| `experimental.chat.system.transform` | Inject vault context, profile learning, skill suggestions, governance directives |
| `experimental.session.compacting` | Extract facts from conversation into vault |
| `permission.ask` | Deny file/bash permissions (enforces policy ceiling) |

### Onboarding

Two-layer user profiling that runs invisibly on every message:

**Layer 1 -- Statistical (instant, zero cost):** tinyld detects language from text (62 languages, ISO 639-1). Unicode codepoint ranges classify writing system (Latin, Cyrillic, Arabic, CJK, Devanagari, Thai, Georgian, Hebrew, Greek, Hangul). Active hours and response style tracked automatically.

**Layer 2 -- LLM-powered:** The AI uses `enrich_profile` to silently store what it learns through conversation. Core fields (name, language, timezone) write directly to the vault profile. The `[PROFILE LEARNING]` block in every system prompt tells the AI to call `enrich_profile` as it discovers things.

First-contact detection injects a language-agnostic meta-prompt so the AI responds in the user's language from the first message.

### Heartbeat

Adaptive health monitoring with self-healing. Five parallel checkers (bridge, channels, vault, sessions, memory) run on configurable intervals that tighten as health degrades:

- Healthy: 60s. Degraded: 15s. Critical: 5s.
- Self-healing: up to 3 automatic recovery attempts with backoff.
- Multi-agent: each agent (production, staging, etc.) runs independent schedules.
- Active hours gating: skip checks outside business hours (IANA timezone).
- Alert dedup: same alert suppressed within configurable window (default 24h).
- Empty-check + exponential backoff: skip full check when all healthy and unchanged.
- Coalescing: debounce rapid requests, defer when AI queue is busy.

### CLI Tools

Sandboxed integration with local CLI binaries. Config-driven: declare a binary, its subcommands, and which arguments each action accepts. The executor validates against a whitelist before spawning (execFile, not exec -- no shell injection). Always appends `--json --no-input`.

Currently wraps `gog` (Google Calendar, Gmail, Contacts, Tasks, Drive). Extensible to any CLI that outputs JSON (bird, himalaya, etc.).

### Memory Vault

SQLite database at `~/.iris/vault.db`. FTS5 full-text search on memory content. Tables: `memories`, `memories_fts`, `profiles`, `profile_signals`, `audit_log`, `governance_log`, `usage_log`, `heartbeat_log`, `heartbeat_actions`, `heartbeat_dedup`.

The `experimental.chat.system.transform` hook auto-injects user profile and relevant memories into every system prompt.

### Enforcement Hierarchy

Three layers checked on every tool call:

1. **Master Policy** (ceiling) -- what tools/modes/permissions CAN exist. Config-driven, immutable at runtime.
2. **Governance Rules** (behavioral) -- constraints, rate limits, audit logging.
3. **Agent Config** (per-agent) -- tool/permission restrictions (always a subset of policy).

Each layer narrows. Never widens.

## Security

Four DM policy modes per channel:

| Mode | Behavior |
|------|----------|
| `open` | Anyone can talk |
| `pairing` | New users get a code, owner approves via CLI (default) |
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
iris scan [path]                    Scan directory for security issues
```

## Project Structure

```
src/
  index.ts              Entry point
  config/               Config loading, Zod schema, types
  channels/             Channel adapters (ChannelAdapter interface)
    telegram/           grammy
    whatsapp/           baileys
    discord/            discord.js
    slack/              @slack/bolt
    webchat/            Hono WebSocket (Canvas integration)
    registry.ts         Runtime adapter registry
    message-cache.ts    Cross-adapter message dedup
  bridge/               OpenCode integration
    opencode-client.ts  SDK wrapper (spawn, connect, queue tracking)
    session-map.ts      channelId:chatType:chatId -> OpenCode session
    message-router.ts   Inbound routing pipeline + first-contact detection
    event-handler.ts    SSE stream processing
    stream-coalescer.ts Text delta coalescing with break detection
    tool-server.ts      Hono HTTP server (port 19877) -- all tool endpoints
    message-queue.ts    Delivery queue with retry
  vault/                Persistent memory (SQLite + FTS5)
    db.ts               Connection, schema migration
    store.ts            CRUD: memories, profiles, audit, governance
    search.ts           FTS5 full-text search
  governance/           Rule engine + master policy
    engine.ts           Evaluate rules against tool calls
    policy.ts           Structural ceiling enforcement
  security/             DM policy, pairing, allowlist, rate limiter, code scanner
  plugins/              Plugin SDK (discovery, loading, security scan, hook bus)
  onboarding/           Two-layer user profiling
    enricher.ts         tinyld language + Unicode script + active hours + response style
    signals.ts          Signal store (SQLite)
  heartbeat/            Health monitoring with self-healing
    engine.ts           Multi-agent orchestrator (adaptive intervals, empty-check, coalescing)
    checkers.ts         Bridge, Channel, Vault, Session, Memory checkers
    store.ts            SQLite (heartbeat_log, heartbeat_actions, heartbeat_dedup)
    active-hours.ts     Timezone-aware window gating
    visibility.ts       Per-channel alert visibility
    empty-check.ts      Hash-based skip + exponential backoff
    coalesce.ts         Debounce + queue-aware gate
    activity.ts         User activity tracking for dormancy
  cli/                  CLI tool integration + Iris CLI commands
    executor.ts         Sandboxed child_process.execFile runner
    registry.ts         Config-driven tool -> command mapper
    types.ts            CliConfig, CliToolDef, CliExecResult
    program.ts          Iris CLI (clipanion)
    commands/           CLI command implementations
  proactive/            Proactive follow-up system
    engine.ts           Pulse engine (poll, scan, quiet hours)
    store.ts            Intent/trigger persistence (SQLite)
  auto-reply/           Template-based auto-reply engine
  usage/                Usage and cost tracking
  canvas/               Canvas UI (A2UI) -- Hono + WebSocket + Chart.js
  cron/                 Scheduled jobs (croner)
  media/                Image/audio processing (sharp)
  logging/              Structured logging (pino)
  utils/                Shared utilities

.opencode/
  plugin/iris.ts        THE plugin (40+ tools, 5 hooks, dynamic CLI/plugin tools)
  opencode.json         Model config, MCP servers, permissions
  agents/               chat.md (primary), moderator.md (subagent)
  skills/               greeting, help, moderation, onboarding, summarize, web-search

test/
  unit/                 57 test files
  integration/          13 test files (pipeline, plugin SDK, streaming, auto-reply)
```

## Docker

```
docker build -t iris .
docker run -d --name iris --env-file .env -v iris-state:/root/.iris -p 19876:19876 iris
```

## Documentation

- `docs/configuration.md` -- Full config reference with all options
- `docs/cookbook.md` -- Patterns for policy, governance, vault, hooks, agents, skills, onboarding, heartbeat, CLI tools, proactive system
- `docs/deployment.md` -- Docker, systemd, nginx, monitoring, Prometheus

## License

MIT
