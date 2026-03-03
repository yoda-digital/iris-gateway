# Iris Gateway

**Your self-hosted AI assistant that talks to you on Telegram, WhatsApp, Discord, and Slack — powered entirely by free AI models.**

Run a personal AI with memory, goals, and proactive nudges on your own server, at zero model cost, using [OpenRouter's free tier](https://openrouter.ai) (Arcee Trinity works great).

[![Version](https://img.shields.io/badge/version-1.1.0-blue)](https://github.com/yoda-digital/iris-gateway/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

- 💸 **Free models that actually work** — Arcee Trinity (large + mini) on OpenRouter's free tier handles both chat and tool calling
- 🧠 **Intelligence layer** — learns who you are from every conversation without you lifting a finger
- 📱 **All your channels, one brain** — Telegram, WhatsApp, Discord, Slack, WebChat share a single memory
- 🎯 **Goal and arc tracking** — remembers what you're working on, follows up when relevant
- 🔧 **40+ built-in tools** — calendar, email, contacts, tasks, web search out of the box
- 🛡️ **Self-healing health monitor** — detects degradation and recovers automatically
- 🔌 **Extensible** — write plugins, add CLI tools, create custom skills

---

## Quick Start

Get Iris talking on Telegram in under 10 minutes:

```bash
# 1. Clone and install
git clone https://github.com/yoda-digital/iris-gateway.git iris && cd iris
pnpm install

# 2. Configure
cp iris.config.example.json iris.config.json
echo "TELEGRAM_BOT_TOKEN=your_token_here" > .env

# 3. Build and run
pnpm run build && pnpm start

# 4. Verify
curl http://127.0.0.1:19876/health
```

**Telegram bot token:** [@BotFather](https://t.me/botfather) → `/newbot`  
**Free AI models:** Sign up at [openrouter.ai/keys](https://openrouter.ai/keys) — Arcee Trinity works on the free tier  
**Full config reference:** [docs/configuration.md](docs/configuration.md)

### Docker (even faster)

```bash
cp iris.config.example.json iris.config.json
echo "TELEGRAM_BOT_TOKEN=your_token" > .env
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
| Self-hosted | ✅ | ✅ | ✅ |
| Setup time | ~10 min | days | hours |

---

## What People Use It For

**Personal AI assistant** — Replace generic chatbots with something that knows your name, remembers your projects, and follows up when a deadline is approaching. Works across all your messaging apps simultaneously.

**Smart home/server automation** — Send messages from cron jobs, get AI-summarized alerts, ask questions about your infrastructure in plain language from your phone.

**Team assistant** — Deploy to a Discord or Slack server, configure per-channel policies, add custom tools, and give your team an AI that respects governance rules you define.

---

## Architecture

Two cooperating processes connected via HTTP IPC:

1. **Iris Gateway** (Node.js) — manages channels, security, vault, governance, tool server on port 19877
2. **OpenCode CLI** (AI backend) — auto-spawned or external on port 4096. A single plugin gives the AI access to all 40+ Iris tools via HTTP callbacks

```
 Telegram --+
 WhatsApp --+                                         +------------+
 Discord  --+-- Adapters --> Auto-Reply --> Router --> | OpenCode   |--> AI Model
 Slack    --+      |          Engine        |         | Bridge     |
 WebChat  --+      v                        v         |            |
               Security              Stream           | Plugin SDK |
               Gate                  Coalescer        | (40+ tools)|
                                                      +------+-----+
                              +--------+--------+--------+---+---+--------+
                              |        |        |        |       |        |
                           Vault    Policy   Govern.  Proact.  Heart.   CLI
                         (SQLite)  Engine    Engine   Engine   Engine   Exec.
                              |                          |       |
                        Intelligence Layer           Outcome  Trend
                        (Bus, Inference,            Analyzer  Detector
                         Triggers, Arcs,              |        |
                         Goals, CrossCh)          HealthGate  gog, ...
```

**Inbound flow:** platform message → adapter normalize → security check → auto-reply → onboarding enrichment → inference engine → trigger evaluator → OpenCode prompt → streaming coalesce → deliver

### Intelligence Layer

Seven deterministic subsystems — zero LLM cost, pure Node.js + SQLite:

- **Signal Inference Engine** — derives timezone, language, engagement trend, session patterns from raw signals
- **Event-Driven Triggers** — structural pattern detection (temporal markers, dormancy, engagement drops). Language-agnostic.
- **Outcome-Aware Proactive Loop** — tracks engagement by category (task/work/health/hobby/social). AI-assigned categories, not keyword-guessed.
- **Memory Arcs** — temporal threads tracking evolving situations. Auto-stale after 14 days.
- **Goal Tracking** — persistent goals with state machine, success criteria, next-action queue
- **Cross-Channel Intelligence** — unified presence detection across all channels
- **Self-Tuning Heartbeat** — linear regression trend detection, predictive threshold breach, health-aware proactive throttling

### Security

Four DM policy modes: `open`, `pairing` (default — new users get a code you approve via CLI), `allowlist`, `disabled`. Rate limiting per user per channel. Groups support `requireMention` gating.

---

## CLI

```bash
iris gateway run          # Start the gateway
iris doctor               # Diagnostic checks
iris status               # Gateway status
iris pairing list|approve # Manage pairing codes
iris session list|reset   # Manage sessions
iris config validate      # Validate config
iris send <ch> <to> <msg> # One-shot message
```

---

## Documentation

- [docs/configuration.md](docs/configuration.md) — Full config reference with all options
- [docs/cookbook.md](docs/cookbook.md) — Patterns for policy, governance, vault, hooks, skills
- [docs/deployment.md](docs/deployment.md) — Docker, systemd, nginx, monitoring, Prometheus

## License

MIT
