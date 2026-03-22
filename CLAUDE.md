# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
pnpm install                        # Install dependencies
pnpm run build                      # TypeScript compile (tsc)
pnpm run lint                       # Type check without emitting (tsc --noEmit)
pnpm test                           # Run all tests (vitest run)
pnpm run test:watch                 # Watch mode
npx vitest run test/unit/foo.test.ts            # Single test file
npx vitest run -t "test name pattern"           # Single test by name
pnpm run dev                        # Dev mode (tsx + .env hot reload)
pnpm run build && pnpm start        # Production
```

Coverage thresholds: 75% statements/branches/functions/lines.

## Architecture

Iris is a multi-channel AI messaging gateway. Messages flow from platform adapters through a routing pipeline to OpenCode CLI (the AI backend), then responses flow back.

### The Two Processes

Iris runs as **two cooperating processes** connected via HTTP IPC:

1. **Iris Gateway** (`src/gateway/lifecycle.ts`) — Node.js server that manages channels, security, vault, governance, and exposes the tool server on port 19877.
2. **OpenCode CLI** — The AI backend (auto-spawned or external on port 4096). Iris registers a single plugin (`.opencode/plugin/iris.ts`) that gives the AI access to all Iris tools via HTTP callbacks to the tool server.

This means: the AI calls tools → plugin makes HTTP POST to `http://127.0.0.1:19877/tool/*` → Iris executes and returns result.

### Message Flow (Inbound)

```
Platform message
  → Channel adapter normalizes to InboundMessage
  → SecurityGate checks DM policy (open/pairing/allowlist)
  → Auto-reply engine checks for template matches (src/auto-reply/)
  → SessionMap resolves (channelId, chatId, chatType) → OpenCode session ID
  → OpenCode bridge sends prompt to AI
  → AI processes, calls tools via plugin hooks
  → Response delivered back through adapter
```

### Session Identity

`SessionMap` (`src/bridge/session-map.ts`) maps `channelId:chatType:chatId` → OpenCode session. Each session entry stores `senderId` from the original message. The tool server resolves `sessionID → senderId` via `SessionMap.findBySessionId()` when the plugin hook needs to know who triggered a tool call.

### The Plugin (`.opencode/plugin/iris.ts`)

This single file is the bridge between OpenCode and Iris. It contains:
- **All tool definitions** — each tool is a thin HTTP wrapper calling back to the Iris tool server
- **All hooks** — `tool.execute.before` (policy + governance enforcement), `tool.execute.after` (audit), `experimental.chat.system.transform` (vault context + skill suggestion injection), `experimental.session.compacting` (fact extraction), `permission.ask` (deny file/bash)
- **Dynamic plugin tools** — reads `~/.iris/plugin-tools.json` manifest and registers wrappers
- **Dynamic CLI tools** — reads `~/.iris/cli-tools.json` manifest and registers grouped tools with action enums

### Tool Server (`src/bridge/tool-server.ts` + `src/bridge/routers/`)

Hono HTTP server (port 19877) that handles all tool execution. Routes are split into domain routers under `src/bridge/routers/`:
- `routers/channels.ts` — `/tool/*` channel operations (send-message, send-media, channel-action, user-info)
- `routers/vault.ts` — `/vault/*` memory CRUD, search, context injection, batch storage
- `routers/governance.ts` — `/governance/*`, `/policy/*`, `/rules/*`, `/agents/*`, `/skills/*`
- `routers/intelligence.ts` — `/goals/*`, `/arcs/*`, `/traces`, `/proactive/*`, `/onboarding/*`
- `routers/cli.ts` — `/cli/:toolName` sandboxed binary calls
- `routers/system.ts` — `/session/*`, `/heartbeat/*`, `/audit/*`, `/usage/*`, `/canvas/*`, `/tools/*`

Key routes:
- `/traces` — execution trace debugging (added in v1.12.0)
- `/goals/*` — goal CRUD (create, update, complete, pause, resume, abandon, list)
- `/arcs/*` — narrative arc management (list, resolve, add-memory)
- `/session/*` — system prompt context building (includes intelligence context via PromptAssembler)

### Bridge Infrastructure (`src/bridge/`)

Beyond tool-server and session-map, the bridge has several critical components:
- **`supervisor.ts`** — `BridgeSupervisor`: health monitoring, circuit breaking, and restart logic. Max 5 restarts with exponential backoff (1s → 30s). Queues messages during restart window (max 50).
- **Readiness check** (`lifecycle.ts`) — on startup, polls `bridge.checkHealth()` (HTTP GET /health to OpenCode) with a 60s timeout before accepting inbound messages. Pure HTTP polling — no session creation, no LLM messages, zero token cost. `sendMessage` is never called during warmup. Prior approach (sending a `__readiness_check__` ping message) was removed in #176 due to token waste and vault pollution.
- **`circuit-breaker.ts`** — circuit breaker pattern for OpenCode client resilience
- **`opencode-client.ts`** — the actual HTTP/WS client to the OpenCode process
- **`message-queue.ts`** — buffers inbound messages during bridge restarts
- **`stream-coalescer.ts`** — coalesces streaming response chunks
- **`event-handler.ts`** — bridge event dispatch

### Enforcement Hierarchy

Three layers checked on every tool call (in `tool.execute.before` hook):
1. **Master Policy** (`src/governance/policy.ts`) — structural ceiling from config. What tools/modes/permissions CAN exist.
2. **Governance Rules** (`src/governance/engine.ts`) — behavioral rules. Constraints, rate limits, audit logging.
3. **Agent Config** — per-agent tool/permission restrictions (subset of policy).

Each layer can only narrow further, never widen. Policy is also checked at agent/skill creation time (403 on violation).

### Vault (Persistent Memory)

SQLite database at `~/.iris/vault.db` with FTS5 full-text search. Tables: `memories`, `memories_fts`, `profiles`, `profile_signals`, `audit_log`, `governance_log`, `usage_log`, `heartbeat_log`, `heartbeat_actions`, `heartbeat_dedup`, `derived_signals`, `inference_log`, `proactive_outcomes`, `memory_arcs`, `arc_entries`, `goals`. The `experimental.chat.system.transform` hook injects user profile + relevant memories + intelligence context into every system prompt automatically.

### Onboarding

Two-layer user profiling (`src/onboarding/`). Layer 1: tinyld language detection (62 languages) + Unicode script classification + active hours + response style -- instant, zero cost. Layer 2: AI uses `enrich_profile` tool to store what it learns through conversation. First-contact detection injects a language-agnostic meta-prompt.

### Heartbeat

Adaptive health monitoring (`src/heartbeat/`). Five checkers (bridge, channels, vault, sessions, memory) on intervals that tighten as health degrades (60s/15s/5s). Self-healing with backoff. Multi-agent support. Active hours gating (IANA timezone). Alert dedup. Empty-check optimization with exponential backoff. Request coalescing.

### Intelligence Layer

Twelve deterministic subsystems in `src/intelligence/` — zero LLM cost, all pure Node.js + SQLite:

- **IntelligenceBus** (`bus.ts`) — typed synchronous event emitter connecting all subsystems.
- **IntelligenceStore** (`store.ts`) — thin facade delegating to four domain stores. Provides a unified interface; domain stores own schema and methods:
  - **InferenceStore** (`inference/store.ts`) — derived_signals, inference_log
  - **OutcomesStore** (`outcomes/store.ts`) — proactive_outcomes
  - **ArcsStore** (`arcs/store.ts`) — memory_arcs, arc_entries
  - **GoalsStore** (`goals/store.ts`) — goals
- **InferenceEngine** (`inference/engine.ts`) — runs 5 statistical rules (timezone, language stability, engagement trend, response cadence, session pattern) with cooldowns.
- **TriggerEvaluator** (`triggers/evaluator.ts`) — synchronous regex/signal rules in the message pipeline.
- **OutcomeAnalyzer** (`outcomes/analyzer.ts`) — category-segmented engagement tracking with timing patterns.
- **ArcDetector** (`arcs/detector.ts`) — detects narrative threads from keyword overlap.
- **ArcLifecycle** (`arcs/lifecycle.ts`) — persistent arc state management.
- **GoalLifecycle** (`goals/lifecycle.ts`) — persistent goal state machine (active/paused/completed/abandoned).
- **CrossChannelResolver** (`cross-channel/resolver.ts`) — unified presence/preference detection.
- **TrendDetector** (`health/trend-detector.ts`) — linear regression on heartbeat metrics.
- **HealthGate** (`health/gate.ts`) — throttles proactive activity based on system health.
- **PromptAssembler** (`prompt-assembler.ts`) — builds structured prompt sections from all intelligence sources.

Initialized in `lifecycle.ts` after onboarding. Wired into the message pipeline (adapter handler) for inference + trigger evaluation + engagement marking + arc detection.

### Auto-Reply Engine (`src/auto-reply/`)

`TemplateEngine` processes inbound messages against config-defined templates before they reach the AI. Templates support regex/keyword matching, channel/chat-type filtering, cooldowns, once-only firing, and priority ordering. Checked in the message router after security gating.

### Cron Service (`src/cron/`)

`CronService` (using `croner` library) manages scheduled jobs stored in SQLite. Each job creates an OpenCode session, delivers the scheduled prompt, and routes the response to a configured channel. `CronRunLogger` tracks execution history. Jobs are persisted across restarts.

### Instance Coordinator (`src/instance/coordinator.ts`)

`InstanceCoordinator` enables multiple iris-gateway instances to share a single SQLite database safely. Uses a `instance_locks` table with TTL-based leader election (10s TTL, 4s renewal). Only the leader runs singleton operations (cron, intelligence sweep, proactive engine). Each instance gets a unique ID via `IRIS_INSTANCE_ID` env var or auto UUID.

### Media (`src/media/`)

Media handling subsystem: fetch remote media (fetch.ts), MIME type detection (mime.ts), compression (compress.ts), parsing (parse.ts), HTTP media server (server.ts), and local store (store.ts). Used by channel adapters for inbound/outbound media messages.

### SDK (`src/sdk/client.ts`)

`IrisClient` — typed HTTP client for the tool-server API (port 19877). Designed for out-of-process plugins and external integrations. Covers vault search/store/extract, goals, arcs, proactive intents, governance, sessions, and execution traces. Published as a versioned npm package (see `exports` field in `package.json`).

```ts
import IrisClient from "@yoda.digital/iris-gateway/sdk";
const iris = new IrisClient({ baseUrl: "http://localhost:19877" });
const { results } = await iris.vault.search({ query: "project goals", limit: 5 });
```

### CLI Tools

Sandboxed CLI binary integration (`src/cli/`). Config-driven: binary whitelist + per-tool action definitions with typed subcommands, positional args, and flags. Executor uses `execFile` (no shell). Always appends `--json --no-input`. Manifest written to `~/.iris/cli-tools.json` for plugin auto-registration. Currently wraps `gog` (Google Calendar, Gmail, Contacts, Tasks, Drive).

### Proactive System

Follow-up intelligence (`src/proactive/`). AI registers intents to check back on users. Passive scans detect dormant users. Soft quotas, quiet hours, engagement tracking.

### Channel Adapters

All adapters implement `ChannelAdapter` interface (`src/channels/adapter.ts`). Each adapter:
- Normalizes platform messages to `InboundMessage`
- Emits events via `TypedEventEmitter<ChannelEvents>`
- Implements `sendText()`, optional `sendMedia()`, `sendTyping()`, `sendReaction()`, `editMessage()`, `deleteMessage()`

Adapters: Telegram (grammy), WhatsApp (baileys), Discord (discord.js), Slack (@slack/bolt), WebChat (Hono WebSocket).

### Plugin SDK

Iris plugins (`src/plugins/types.ts`) can register tools, channels, services, and hooks. Plugins are auto-discovered from `./plugins/` and `~/.iris/plugins/`. Security-scanned before loading (`src/security/scanner.ts`). Plugin tools are exposed to the AI via a manifest file that the OpenCode plugin reads at startup.

## Key Patterns

- **ESM-only**: All imports use `.js` extensions (`import { Foo } from "./foo.js"`). TypeScript compiles to ESM (`"module": "NodeNext"`).
- **Zod validation**: All HTTP request bodies validated with Zod schemas before processing.
- **Config schema**: `src/config/schema.ts` (Zod) validates config, `src/config/types.ts` defines TypeScript interfaces. Always update both when changing config shape.
- **Hono for HTTP**: Both tool server (19877) and health server (19876) use Hono. Canvas server also uses Hono + WebSocket.
- **Pino for logging**: Structured JSON logging via `src/logging/logger.ts`.
- **AbortController for shutdown**: Graceful shutdown propagated via `AbortSignal` to all adapters and services.

## Testing

Tests live in `test/unit/` and `test/integration/`. Use vitest. Mocks are inline (no mock files). Common pattern: create temp directory with `mkdtempSync`, clean up in `afterEach`. SQLite tests use in-memory or temp-dir databases.

## Important Files

| File | Role |
|------|------|
| `src/gateway/lifecycle.ts` | Wires everything together — the dependency injection root. Model-sync delegated to `src/config/model-sync.ts`. |
| `src/config/model-sync.ts` | Syncs `iris.config.json` model list → `opencode.json` + agent frontmatter at startup. Emits `logger.warn` on config read/write errors or API failures during model sync. |
| `.opencode/plugin/iris.ts` | THE plugin — all tools + hooks in one file |
| `src/bridge/tool-server.ts` | Tool server entry point — mounts domain routers |
| `src/bridge/routers/` | Domain routers — each file owns a slice of the tool-server API |
| `src/bridge/supervisor.ts` | Bridge health, circuit breaking, restart with exponential backoff |
| `src/bridge/message-router.ts` | Inbound message routing pipeline + first-contact detection |
| `src/bridge/session-map.ts` | Session identity resolution |
| `src/sdk/client.ts` | IrisClient — typed HTTP SDK for external/plugin integrations |
| `src/cron/service.ts` | CronService — scheduled job execution via croner |
| `src/instance/coordinator.ts` | InstanceCoordinator — multi-instance leader election via SQLite TTL |
| `src/auto-reply/engine.ts` | TemplateEngine — keyword/pattern auto-replies before AI routing |
| `src/config/schema.ts` + `types.ts` | Config shape — update both together |
| `src/cli/executor.ts` | Sandboxed CLI binary runner |
| `src/cli/registry.ts` | Config-driven tool-to-command mapper |
| `src/onboarding/enricher.ts` | tinyld language + Unicode script + statistical profiling |
| `src/heartbeat/engine.ts` | Multi-agent health orchestrator |
| `src/intelligence/store.ts` | Intelligence store facade — delegates to 4 domain stores below |
| `src/intelligence/inference/store.ts` | InferenceStore — derived_signals, inference_log |
| `src/intelligence/outcomes/store.ts` | OutcomesStore — proactive_outcomes |
| `src/intelligence/arcs/store.ts` | ArcsStore — memory_arcs, arc_entries |
| `src/intelligence/goals/store.ts` | GoalsStore — goals |
| `src/intelligence/bus.ts` | Typed event bus connecting all intelligence subsystems |
| `src/intelligence/prompt-assembler.ts` | Structured prompt builder (arcs, goals, outcomes, health) |
| `AGENTS.md` | AI behavioral rules (injected into all agents) |
| `docs/cookbook.md` | Comprehensive usage patterns and examples |

## Commit Style

Conventional commits: `feat(scope):`, `fix(scope):`, `refactor:`, `docs:`, `test:`.

Versioning is fully automated via semantic-release. **Never manually edit the `version` field in `package.json`** — it is bumped automatically on every push to `main` based on commit types:
- `feat:` / `feat(scope):` — minor bump (0.x.0)
- `fix:` / `perf:` / `refactor:` — patch bump (0.0.x)
- `BREAKING CHANGE:` in commit footer — major bump (x.0.0)
- `docs:`, `test:`, `chore:`, `ci:`, `style:` — no release

The release pipeline (`.github/workflows/release.yml`) runs after CI passes on `main`, generates CHANGELOG.md, tags the release, and creates a GitHub Release. Configuration lives in `.releaserc.json`.

## ⚠️ Model Policy — MANDATORY

Iris uses **ONLY free OpenRouter models**. No exceptions.

- ✅ `openrouter/arcee-ai/arcee-spotlight:free`
- ✅ `openrouter/arcee-ai/trinity-large-preview:free`
- ✅ `openrouter/arcee-ai/trinity-mini:free`
- ✅ `openrouter/meta-llama/llama-3.3-70b-instruct:free`
- ✅ `openrouter/mistralai/mistral-7b-instruct:free`
- ❌ `anthropic/claude-*` — NEVER. Requires paid API key.
- ❌ `openai/gpt-4o` — NEVER. Requires paid API key.

When updating model references, default presets, or wizard options: **always use free OpenRouter models only**.

## CI Security — Claude Code Permissions

The `.claude/settings.json` file restricts what Claude Code can do in CI to prevent prompt injection attacks.

### Allowed Operations
- **Bash:** scoped to specific tools (`git`, `pnpm`, `npm`, `npx`, `tsc`, `vitest`, `node`, standard Unix utils like `cat`, `ls`, `grep`, `sed`, etc.)
- **Edit/Read/Glob/Grep/MultiEdit:** unrestricted (read-only risk is minimal)
- **Write:** restricted to `/home/runner/work/**` (repo workspace) and `/tmp/iris-*`

### Denied Operations
- **Network:** `curl`, `wget`, `ssh`, `scp`, `nc`, `netcat` — prevents secret exfiltration
- **Shell injection vectors:** `bash -c *`, `sh -c *`, `eval *`, `exec *`
- **Sensitive reads:** `~/.ssh/`, `~/.aws/`, `/etc/shadow`, `env`/`printenv` output piping
- **Sensitive writes:** `~/.ssh/`, `~/.aws/`, `/etc/`, `/usr/`

### Label Protection
The `needs-changes-loop` label triggers Claude Code CI. To reduce abuse surface:
- Only maintainers should apply this label (enforced via `.github/CODEOWNERS` + branch protection)
- Configure via: Repository Settings → Branches → Add ruleset → Restrict who can push/apply labels

### Threat Model
A contributor with label access + a malicious PR body could trigger arbitrary bash execution via `Bash(*)`. The scoped allowlist reduces the blast radius to only safe development operations.

