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

Coverage thresholds: 70% statements/branches/functions/lines.

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
  → Auto-reply engine checks for template matches
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

### Tool Server (`src/bridge/tool-server.ts`)

Hono HTTP server (port 19877) that handles all tool execution. This is the largest file in the codebase. Routes are organized by domain:
- `/tool/*` — channel operations (send-message, send-media, channel-action, user-info)
- `/vault/*` — memory CRUD, search, context injection, batch storage
- `/governance/*` — rule evaluation, status
- `/policy/*` — master policy check, permission check, audit
- `/skills/*` — CRUD, validation, suggestion matching
- `/agents/*` — CRUD, validation
- `/rules/*` — AGENTS.md read/update/append
- `/tools/*` — custom tools discovery and scaffolding
- `/canvas/*` — Canvas UI updates
- `/session/*` — system prompt context building
- `/audit/*`, `/usage/*` — logging and tracking

### Enforcement Hierarchy

Three layers checked on every tool call (in `tool.execute.before` hook):
1. **Master Policy** (`src/governance/policy.ts`) — structural ceiling from config. What tools/modes/permissions CAN exist.
2. **Governance Rules** (`src/governance/engine.ts`) — behavioral rules. Constraints, rate limits, audit logging.
3. **Agent Config** — per-agent tool/permission restrictions (subset of policy).

Each layer can only narrow further, never widen. Policy is also checked at agent/skill creation time (403 on violation).

### Vault (Persistent Memory)

SQLite database at `~/.iris/vault.db` with FTS5 full-text search. Tables: `memories`, `memories_fts`, `profiles`, `audit_log`, `governance_log`, `usage_log`. The `experimental.chat.system.transform` hook injects user profile + relevant memories into every system prompt automatically.

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

Known: 6 pre-existing test failures in `pipeline.test.ts` and `message-router.test.ts` related to `sendAndWait` mock — these predate current work.

## Important Files

| File | Role |
|------|------|
| `src/gateway/lifecycle.ts` | Wires everything together — the dependency injection root |
| `.opencode/plugin/iris.ts` | THE plugin — all tools + hooks in one file |
| `src/bridge/tool-server.ts` | Largest file — all HTTP tool endpoints |
| `src/bridge/message-router.ts` | Inbound message routing pipeline |
| `src/bridge/session-map.ts` | Session identity resolution |
| `src/config/schema.ts` + `types.ts` | Config shape — update both together |
| `AGENTS.md` | AI behavioral rules (injected into all agents) |
| `docs/cookbook.md` | Comprehensive usage patterns and examples |

## Commit Style

Conventional commits: `feat(scope):`, `fix(scope):`, `refactor:`, `docs:`, `test:`.
