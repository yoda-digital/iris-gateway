# Iris — Multi-Channel AI Messenger

## 1. Project Mission

Iris is a multi-channel AI messaging gateway powered by OpenCode CLI with free models via OpenRouter. It connects messaging platforms (Telegram, WhatsApp, Discord, Slack) to an AI backbone that costs $0 in model fees.

Named after the Greek goddess who carried words between Olympus and the mortal world — many channels, one voice.

## 2. Architecture

```
User -> [Telegram/WhatsApp/Discord/Slack]
  -> Channel Adapter (parses platform message)
  -> Security Gate (DM policy, pairing, allowlist, rate limit)
  -> Message Router (resolves/creates OpenCode session via SDK)
  -> OpenCode Server (processes with free model, may call custom tools)
  -> Event Handler (consumes SSE response stream)
  -> Message Router (chunks text, routes back)
  -> Channel Adapter (sends via platform SDK)
  -> User receives response
```

```
+---------------------------------------------------+
|                  Iris Process                       |
|                                                    |
|  +----------+  +----------+  +--------------+      |
|  | Telegram  |  | WhatsApp |  |   Discord    |     |
|  | Adapter   |  | Adapter  |  |   Adapter    |     |
|  +-----+-----+  +----+-----+  +------+-------+    |
|        |              |               |            |
|        +--------------+---------------+            |
|                       |                            |
|              +--------v--------+                   |
|              |  Security Gate  |                   |
|              +--------+--------+                   |
|                       |                            |
|              +--------v--------+                   |
|              | Message Router  |                   |
|              | + Session Map   |                   |
|              +--------+--------+                   |
|                       |                            |
|              +--------v--------+                   |
|              | OpenCode Bridge |                   |
|              |  (SDK Client)   |                   |
|              +--------+--------+                   |
|                       | HTTP API                   |
|              +--------v--------+                   |
|              |  Tool Callback  |                   |
|              |  HTTP Server    |                   |
|              +-----------------+                   |
+---------------------------------------------------+
                        |
                        | localhost:4096
                        v
+---------------------------------------------------+
|             OpenCode Server Process                |
|  Model: openrouter/free                            |
|  Custom Tools: send_message, user_info, etc.       |
|  Agent: chat (system prompt for messaging)         |
+---------------------------------------------------+
```

## 3. Tech Stack

- **Runtime:** Node.js 22+ with ESM
- **Language:** TypeScript 5.x, strict mode
- **Package manager:** pnpm
- **AI backbone:** OpenCode CLI (`opencode serve` + `@opencode-ai/sdk`)
- **Models:** OpenRouter free models (Llama 3.3 70B, Gemma, Mistral via `openrouter/free`)
- **Telegram:** grammY
- **WhatsApp:** @whiskeysockets/baileys
- **Discord:** discord.js
- **Slack:** @slack/bolt (socket mode)
- **CLI:** Commander.js
- **Config validation:** Zod
- **HTTP server:** Express 5
- **Logging:** tslog (structured)
- **Testing:** Vitest + V8 coverage

## 4. Dev Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Run in dev mode (tsx)
pnpm build            # TypeScript build
pnpm test             # Run tests (vitest)
pnpm test:watch       # Watch mode
pnpm test:coverage    # Coverage report
pnpm lint             # Type-check (tsc --noEmit)
pnpm iris             # Run CLI in dev mode
```

## 5. Core Patterns

### Channel Adapter Pattern
Every channel implements `ChannelAdapter` from `src/channels/adapter.ts`:
- `start(config, signal)` / `stop()` lifecycle
- `events` typed emitter for `message`, `error`, `connected`, `disconnected`
- `sendText(params)` required, `sendMedia/sendTyping/sendReaction` optional
- `capabilities` declares what the adapter supports

### Config Loading
- `iris.config.json` is the main config file
- Zod schema validates at load time
- `${env:VAR}` substitution for secrets
- Defaults merged from schema

### Session Mapping
- Each `(channelId, chatId, chatType)` maps to one OpenCode session
- DMs collapse per-sender; groups get one session per group
- JSON persistence in data directory

### Security Gate Pipeline
- Check DM policy → pairing → allowlist → rate limit
- Policy modes: `open`, `pairing`, `allowlist`, `disabled`
- Pairing: 8-char code, 1hr TTL, owner approves via CLI

## 6. OpenCode Integration

Iris uses OpenCode as a headless AI server:
- `opencode serve` starts on port 4096
- `@opencode-ai/sdk` provides typed programmatic access
- Custom tools in `.opencode/tools/` let the LLM interact with channels
- Agent system prompt in `.opencode/agents/chat.md`
- All file/bash tools DENIED — LLM can only use channel tools

### Tool Callback Flow
OpenCode LLM calls custom tool → tool POSTs to Iris tool server (port 19877) → Iris routes to channel adapter → result returned to LLM.

## 7. Free Model Strategy

- **Primary:** `openrouter/free` — auto-routes to best free model with tool calling
- **Fallback:** `openrouter/arcee-ai/trinity-large-preview:free` — verified tools, 131K context
- **Zen tier:** Big Pickle, MiniMax M2.5 Free, GPT 5 Nano Free

All models support function/tool calling. Total cost: $0.

## 8. Key Interfaces

### ChannelAdapter (`src/channels/adapter.ts`)
```typescript
interface ChannelAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ChannelCapabilities;
  start(config: ChannelAccountConfig, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  readonly events: TypedEventEmitter<ChannelEvents>;
  sendText(params: SendTextParams): Promise<{ messageId: string }>;
}
```

### IrisConfig (`src/config/types.ts`)
```typescript
interface IrisConfig {
  readonly gateway: GatewayConfig;
  readonly channels: Record<string, ChannelAccountConfig>;
  readonly security: SecurityConfig;
  readonly opencode: OpenCodeConfig;
  readonly cron?: CronJobConfig[];
  readonly logging?: LoggingConfig;
}
```

### InboundMessage (`src/channels/adapter.ts`)
```typescript
interface InboundMessage {
  readonly id: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly chatId: string;
  readonly chatType: "dm" | "group";
  readonly text?: string;
  readonly timestamp: number;
  readonly raw: unknown;
}
```

## 9. Implementation Phases

1. **Foundation + 4 Channels** — Core infra, all adapters, bridge, CLI entry
2. **Security** — DM policy, pairing, allowlist, rate limiter
3. **OpenCode Deep-Dive** — Plugin hooks, skills, commands
4. **Advanced Features** — LLM tools, MCP, multi-agent, model switching
5. **CLI + Cron + Media** — Full CLI, scheduler, media handling, group features
6. **Extended Channels** — Signal, iMessage, Web, IRC
7. **Ecosystem** — Docker, CI/CD, plugins, npm publishing

## 10. Coding Conventions

- ESM imports with `.js` extensions (NodeNext resolution)
- Prefer `readonly` for interface properties
- Use branded types for IDs where ambiguity exists
- Colocate tests: `foo.ts` → `foo.test.ts` (same directory)
- Keep files under ~500 LOC; split when clarity improves
- Brief comments for non-obvious logic only
- No `any` — use `unknown` and narrow
- Functional patterns over classes where reasonable (utility modules)
- Classes for stateful components (adapters, stores, services)

## 11. Testing

- **Framework:** Vitest with V8 coverage
- **Thresholds:** 70% lines/branches/functions/statements
- **Naming:** `*.test.ts` colocated with source
- **E2E:** `*.e2e.test.ts` in `test/e2e/`
- **Helpers:** `test/helpers/` — mock-opencode, mock-adapter, fixtures
- **Run:** `pnpm test` before committing

## 12. Security

- All OpenCode file/bash tools DENIED via `.opencode/opencode.json`
- LLM can only use custom channel tools (send_message, etc.)
- Pairing system prevents unauthorized access
- Rate limiting per user (sliding window)
- Never commit real tokens — use `${env:VAR}` in config
- Bot tokens in `.env` (gitignored)

## 13. Agent Directives (Multi-Agent Safety)

From OpenClaw patterns:
- Do NOT create/apply/drop git stash entries unless explicitly requested
- Do NOT create/remove/modify git worktree checkouts unless explicitly requested
- Do NOT switch branches unless explicitly requested
- When you see unrecognized files, keep going; focus on your changes
- Scope commits to your changes only
- Running multiple agents is OK as long as each has its own session

## 14. File Locations

```
src/
├── entry.ts                    # CLI entrypoint
├── cli/                        # Commander.js commands
├── config/                     # Config loading, types, schema, paths
├── channels/                   # Channel adapters + infrastructure
│   ├── adapter.ts              # ChannelAdapter interface
│   ├── registry.ts             # Channel registry
│   ├── manager.ts              # Lifecycle management
│   ├── telegram/               # grammY adapter
│   ├── whatsapp/               # Baileys adapter
│   ├── discord/                # discord.js adapter
│   └── slack/                  # Bolt.js adapter
├── bridge/                     # OpenCode SDK integration
│   ├── opencode-client.ts      # SDK wrapper
│   ├── session-map.ts          # Session mapping
│   ├── message-router.ts       # Message dispatch
│   ├── event-handler.ts        # SSE consumer
│   └── tool-server.ts          # Tool callback HTTP server
├── security/                   # DM policy, pairing, allowlist, rate limiter
├── gateway/                    # Startup/shutdown, health check
├── cron/                       # Scheduled messages
├── media/                      # Media handling
├── logging/                    # Structured logging
└── utils/                      # Typed emitter, retry, text chunker
.opencode/
├── opencode.json               # Model + permissions config
├── agents/                     # AI agent definitions
├── tools/                      # Custom LLM-callable tools
├── skills/                     # Reusable messaging workflows
├── commands/                   # Custom bot commands
└── plugins/                    # OpenCode plugin hooks
```
