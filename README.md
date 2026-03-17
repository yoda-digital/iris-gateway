# Iris Gateway

**Your self-hosted AI assistant that talks to you on Telegram, WhatsApp, Discord, and Slack — powered entirely by free AI models.**

Run a personal AI with memory, goals, and proactive nudges on your own server, at zero model cost, using [OpenRouter's free tier](https://openrouter.ai).

[![npm](https://img.shields.io/npm/v/@yoda-digital/iris-gateway)](https://www.npmjs.com/package/@yoda-digital/iris-gateway)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Coverage](https://img.shields.io/badge/coverage-%3E75%25-brightgreen)](docs/configuration.md)

- 💸 **Free models only** — four pre-vetted OpenRouter free-tier presets in the init wizard. No paid API keys required to run.
- 🧠 **Intelligence layer** — derives language, timezone, engagement patterns, and arc state from every conversation without you touching config
- 📱 **All your channels, one brain** — Telegram, WhatsApp, Discord, Slack, WebChat share a single SQLite vault
- 🎯 **Goal and arc tracking** — remembers what you're working on, sets next-action deadlines, follows up when relevant
- 🔧 **40+ built-in tools** — calendar, email, contacts, tasks, web search, vault search out of the box
- 📊 **Execution traces** — turn-grouped audit logs with step indexing for debugging multi-tool workflows
- 🛡️ **Self-healing health monitor** — linear regression trend detection, predictive threshold breach, health-aware throttling
- 🔒 **Master policy enforcement** — structural ceiling for tool access, agent modes, and permission grants — config-driven, immutable at runtime
- 🔌 **Extensible** — write plugins, add CLI tools, create custom skills with trigger-based activation
- 📦 **SDK client** — typed HTTP client for building external integrations against tool-server API
- 🔀 **Multi-instance support** — run multiple nodes against the same SQLite database with automatic leader election

---

## Quick Start

### Install from npm (recommended)

```bash
npm install -g @yoda-digital/iris-gateway
# or
pnpm add -g @yoda-digital/iris-gateway

iris init        # interactive setup wizard
iris gateway run # start the gateway
```

### Clone and run from source

```bash
# 1. Clone and install
git clone https://github.com/yoda-digital/iris-gateway.git iris && cd iris
pnpm install

# 2. Interactive setup (recommended)
iris init

# 3. Build and run
pnpm run build && pnpm start

# 4. Verify
curl http://127.0.0.1:19876/health
```

**Telegram bot token:** [@BotFather](https://t.me/botfather) → `/newbot`  
**Free AI models:** Sign up at [openrouter.ai/keys](https://openrouter.ai/keys) — no credit card required for free tier  
**Full config reference:** [docs/configuration.md](docs/configuration.md)

### Init Wizard

`iris init` walks you through every required setting interactively:

```
$ iris init

◆  Config output path: iris.config.json
◆  Which AI model? › Arcee Trinity Large (free) — OpenRouter, no API key required
◆  OpenCode CLI detected at /usr/local/bin/opencode ✓
◆  Enable Telegram? › Yes
◆  Telegram bot token: ████████████████████
◆  Enable Discord? › No
◆  Writing iris.config.json... done.
```

Free model options: Arcee Spotlight, Arcee Trinity Large, Llama 3.3 70B, Mistral 7B — or enter any custom model string.

### Docker (even faster)

```bash
cp iris.config.example.json iris.config.json
# Edit iris.config.json — set your bot token and model
docker-compose up -d
```

---

## Why Iris?

|  | **Iris** | DIY Bot | n8n |
|---|:---:|:---:|:---:|
| Free AI models | ✅ | ❌ | ❌ |
| Multi-channel (one brain) | ✅ | manual | ✅ |
| Intelligence layer | ✅ | ❌ | ❌ |
| Goal & arc tracking | ✅ | ❌ | ❌ |
| Master policy enforcement | ✅ | ❌ | ❌ |
| Multi-instance (leader election) | ✅ | ❌ | ✅ |
| Self-hosted | ✅ | ✅ | ✅ |
| Setup time | ~10 min | days | hours |

---

## What People Use It For

**Personal AI assistant** — Replace generic chatbots with something that knows your name, remembers your projects, and follows up when a deadline is approaching. Works across all your messaging apps simultaneously.

**Smart home / server automation** — Send messages from cron jobs, get AI-summarized alerts, ask questions about your infrastructure in plain language from your phone.

**Team assistant** — Deploy to a Discord or Slack server, configure per-channel policies, add custom tools, and give your team an AI that respects governance rules you define.

---

## Architecture

Two cooperating processes connected via HTTP IPC:

1. **Iris Gateway** (Node.js) — manages channels, security, vault, governance, and a tool server on port 19877
2. **OpenCode CLI** (AI backend) — auto-spawned or external on port 4096. A single plugin exposes all 40+ Iris tools to the AI via HTTP callbacks

```
 Telegram ─┐
 WhatsApp ─┼── Adapters ──► Auto-Reply ──► Router ──► OpenCode ──► AI Model
 Discord  ─┤      │          Engine                    Bridge
 Slack    ─┤      ▼                                    Plugin SDK
 WebChat  ─┘  Security                                 (40+ tools)
              Gate
               │
               ▼
        ┌──────┴──────────────────────────────────────────┐
        │  Vault   Policy   Govern.  Proact.  Heart.  CLI  │
        │ (SQLite) Engine   Engine   Engine   Engine  Exec │
        └──────┬──────────────────────────────┬────────────┘
               │                              │
        Intelligence Layer              Health Layer
        ┌──────┴──────────┐          ┌────────┴────────┐
        │ Arcs  Goals     │          │ TrendDetector   │
        │ Inference       │          │ HealthGate      │
        │ Triggers        │          │ OutcomeAnalyzer │
        │ CrossChannel    │          └─────────────────┘
        └─────────────────┘
```

**Inbound flow:**
```
platform message
  → adapter normalize
  → security gate (pairing / allowlist / rate-limit)
  → auto-reply check
  → onboarding enrichment
  → inference engine (timezone / language / engagement)
  → trigger evaluator
  → OpenCode prompt
  → streaming coalesce
  → deliver
```

### Intelligence Layer

Seven deterministic subsystems — zero LLM cost, pure Node.js + SQLite:

| Subsystem | What it does |
|-----------|-------------|
| **Signal Inference Engine** | Derives timezone, language, engagement trend, session patterns from raw signals |
| **Event-Driven Triggers** | Structural pattern detection: temporal markers, dormancy, engagement drops. Language-agnostic. |
| **Outcome-Aware Proactive Loop** | Tracks engagement by category (task/work/health/hobby/social). AI-assigned, not keyword-guessed. |
| **Memory Arcs** | Temporal threads tracking evolving situations. Auto-stale after 14 days, configurable. |
| **Goal Tracking** | Persistent goals with state machine, success criteria, next-action queue, due-date alerts |
| **Cross-Channel Intelligence** | Unified presence detection across all channels |
| **Self-Tuning Heartbeat** | Linear regression trend detection, predictive threshold breach, health-aware proactive throttling |

### Multi-Instance Support

Iris supports running multiple instances against the same SQLite database via WAL mode and advisory leader election:

```bash
IRIS_INSTANCE_ID=node-1 pnpm start &
IRIS_INSTANCE_ID=node-2 pnpm start &
```

One instance holds the leader lease and drives proactive/heartbeat engines. Others serve requests in read-write mode. Leader failover is automatic within one election interval (~30s).

See [docs/deployment/multi-instance.md](docs/deployment/multi-instance.md) for full configuration.

### Security

Four DM policy modes:

| Mode | Behavior |
|------|----------|
| `open` | Any user can start a conversation |
| `pairing` _(default)_ | New users get a pairing code you approve via `iris pairing approve` |
| `allowlist` | Only explicitly listed user IDs can interact |
| `disabled` | All DMs rejected |

Rate limiting per user per channel. Groups support `requireMention` gating so Iris only responds when mentioned.

### Master Policy

The `policy` config section defines a structural ceiling for the entire system — immutable at runtime:

```json
{
  "policy": {
    "enabled": true,
    "tools": { "denied": ["rules_update"] },
    "permissions": { "bash": "deny", "edit": "deny" },
    "agents": { "allowedModes": ["subagent"], "maxSteps": 25 },
    "enforcement": { "blockUnknownTools": true }
  }
}
```

Agents and skills can only narrow within the policy — never widen it. See [docs/configuration.md#policy-config](docs/configuration.md#policy-config) for full reference.

---

## CLI

```bash
iris init                 # Interactive setup wizard — generates iris.config.json
iris gateway run          # Start the gateway
iris doctor               # Diagnostic checks (config, OpenCode, channel connectivity)
iris status               # Gateway status (instances, channels, model)
iris pairing list|approve # Manage user pairing codes
iris session list|reset   # Manage channel sessions
iris config validate      # Validate config file (exits non-zero on error)
iris config show          # Show resolved config with secrets redacted
iris send <ch> <to> <msg> # One-shot message without starting the gateway
```

---

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/configuration.md](docs/configuration.md) | Full config reference — every field, type, default, and example |
| [docs/cookbook.md](docs/cookbook.md) | Patterns: policy, governance, vault hooks, skills, cron jobs |
| [docs/deployment.md](docs/deployment.md) | Docker, systemd, nginx reverse proxy, Prometheus metrics |
| [docs/deployment/multi-instance.md](docs/deployment/multi-instance.md) | Multi-instance leader election, WAL mode, instance identity |
| [docs/iris-model-reference.md](docs/iris-model-reference.md) | Model capabilities matrix, fallback chains, speed profiles |
| [docs/sdk/getting-started.md](docs/sdk/getting-started.md) | SDK client — build external plugins in under 30 minutes |
| [docs/tool-api.md](docs/tool-api.md) | Tool-server API reference — every endpoint with request/response types |
| [CHANGELOG.md](CHANGELOG.md) | Full version history |

---

## SDK

Build external plugins and integrations using the typed HTTP client:

```bash
npm install @yoda-digital/iris-gateway
# or
pnpm add @yoda-digital/iris-gateway
```

```typescript
import IrisClient from "@yoda-digital/iris-gateway/sdk";

const iris = new IrisClient({ baseUrl: "http://localhost:19877" });

// Search vault
const { results } = await iris.vault.search({ query: "project goals", limit: 5 });

// Send a message
await iris.channels.sendMessage({ channel: "telegram", to: "123456", text: "Hello!" });

// Check execution traces
const trace = await iris.governance.getTraces("turn-abc-123");
```

Full SDK documentation: [docs/sdk/getting-started.md](docs/sdk/getting-started.md)

Tool-server API reference: [docs/tool-api.md](docs/tool-api.md)

---

## License

MIT
