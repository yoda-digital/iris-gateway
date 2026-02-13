# Proactive Intelligence — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the corresponding plan.

**Goal:** Make Iris a truly proactive agent — one that intelligently follows up on its own messages, anticipates user needs, and initiates actions without being prompted.

**Architecture:** Dual-layer system. Active layer: AI registers follow-up intents during conversation. Passive layer: background pulse detects patterns (dormancy, unanswered questions, engagement drops). Single execution engine re-invokes AI before any action — AI always has final say. Full agency: proactive actions can trigger any tool, not just send_message.

**Tech Stack:** SQLite (extends vault.db), Croner (timer), Hono (endpoints), existing OpenCode bridge + MessageRouter for execution.

---

## Core Concept

Every chatbot in existence is reactive — it waits for input. Iris becomes the first multi-channel bot where the AI itself decides when to reach out, what to do, and whether it's worth it.

### Two Layers, One Engine

**Active Layer (AI-Native Intent):** During normal conversation, Iris calls `proactive_intent` to register a follow-up. Like a human assistant writing themselves a reminder.

```
User: "I'll fix that server issue tomorrow"
Iris: "Great, let me know how it goes!"
       -> internally: proactive_intent({
           what: "check if user fixed server issue",
           why: "user committed to fixing it",
           delayMs: 86400000,
           confidence: 0.9
         })
```

**Passive Layer (Pattern Detection):** Background pulse scans for things the AI missed:
- Dormant users (no message in N days)
- Unanswered questions (AI asked something, no reply)
- Engagement drops (user was daily, now weekly)

**Execution Gate:** Before ANY proactive action fires, AI is re-invoked with fresh context. It can execute, modify, defer, or cancel. AI always has final say.

**Full Agency:** When an intent fires, the AI can do anything — send messages, update vault, push canvas updates, react to old messages, broadcast across channels.

**Soft Quotas + AI Judgment:** AI sees its own quota status (`{remaining: 2, engagement: 67%}`) in the system prompt and self-regulates. Governance directives guide but don't hard-block.

---

## New Components

### 1. IntentStore (`src/proactive/store.ts`)

Extends the existing vault.db with 3 new tables:

```sql
-- AI-registered intents (active layer)
CREATE TABLE IF NOT EXISTS proactive_intents (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  what        TEXT NOT NULL,
  why         TEXT,
  confidence  REAL DEFAULT 0.8,
  execute_at  INTEGER NOT NULL,
  executed_at INTEGER,
  result      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proactive_intents_pending
  ON proactive_intents(execute_at) WHERE executed_at IS NULL;

-- Passive-detected triggers (passive layer)
CREATE TABLE IF NOT EXISTS proactive_triggers (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('dormant_user','unanswered','engagement_drop','external')),
  channel_id  TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  context     TEXT NOT NULL,
  execute_at  INTEGER NOT NULL,
  executed_at INTEGER,
  result      TEXT
);
CREATE INDEX IF NOT EXISTS idx_proactive_triggers_pending
  ON proactive_triggers(execute_at) WHERE executed_at IS NULL;

-- Engagement tracking (self-tuning)
CREATE TABLE IF NOT EXISTS proactive_log (
  id          TEXT PRIMARY KEY,
  sender_id   TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('intent','trigger')),
  source_id   TEXT NOT NULL,
  sent_at     INTEGER NOT NULL,
  engaged     INTEGER DEFAULT 0,
  engagement_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_proactive_log_sender
  ON proactive_log(sender_id, channel_id, sent_at);
```

**Interface:**

```typescript
class IntentStore {
  constructor(vaultDb: VaultDB);

  // Active layer — AI-registered intents
  addIntent(params: AddIntentParams): string;
  listPendingIntents(limit?: number): ProactiveIntent[];
  cancelIntent(id: string): boolean;
  markIntentExecuted(id: string, result: string): void;

  // Passive layer — detected triggers
  addTrigger(params: AddTriggerParams): string;
  listPendingTriggers(limit?: number): ProactiveTrigger[];
  markTriggerExecuted(id: string, result: string): void;
  hasPendingTrigger(senderId: string, type: string): boolean;

  // Engagement tracking + soft quotas
  logProactiveMessage(params: LogProactiveParams): void;
  markEngaged(senderId: string, channelId: string): void;
  getQuotaStatus(senderId: string, channelId: string): QuotaStatus;
  getEngagementRate(senderId: string, channelId: string): number;

  // Passive scan queries
  listDormantUsers(thresholdMs: number, limit: number): DormantUser[];

  // Cleanup
  purgeExpired(maxAgeMs: number): number;
}
```

Design decisions:
- No separate quota table — soft quotas computed from `proactive_log` counts
- Engagement tracking built-in via `engaged` flag — enables self-tuning
- Same vault.db file — no new database

### 2. PulseEngine (`src/proactive/engine.ts`)

The heartbeat. Runs two loops:

**Fast loop (every 60s):** Check for mature intents and triggers, execute them through AI re-evaluation gate.

**Slow loop (every 6h):** Passive scan for dormancy, unanswered questions, engagement drops. Insert new triggers.

```typescript
class PulseEngine {
  constructor(deps: {
    store: IntentStore;
    bridge: OpenCodeBridge;
    router: MessageRouter;
    sessionMap: SessionMap;
    vaultStore: VaultStore;
    registry: ChannelRegistry;
    logger: Logger;
    config: ProactiveConfig;
  });

  start(): void;   // Start both loops
  stop(): void;    // Stop both loops, clean timers

  // Fast loop
  private async tick(): Promise<void>;
  private async executeIntent(intent: ProactiveIntent): Promise<void>;
  private async executeTrigger(trigger: ProactiveTrigger): Promise<void>;

  // Slow loop
  private async passiveScan(): Promise<void>;
  private async detectDormantUsers(): Promise<void>;

  // Shared execution
  private async executeProactive(params: {
    sessionId: string;
    channelId: string;
    chatId: string;
    senderId: string;
    chatType: "dm" | "group";
    prompt: string;
    sourceId: string;
    sourceType: "intent" | "trigger";
  }): Promise<string>;  // Returns result: "sent" | "skipped" | "deferred" | "error"
}
```

**Execution flow for each intent/trigger:**

1. Check confidence threshold (skip if < 0.5)
2. Check max age (expire if > 7 days old)
3. Load user profile + vault memories
4. Compute soft quota status + engagement rate
5. Check timezone (skip if outside 8AM-10PM local)
6. Resolve session via `SessionMap.resolve()` (reuses existing session)
7. Build meta-prompt with all context
8. Send to OpenCode via `bridge.sendAndWait()` — AI decides + acts
9. If AI responded with content (not [SKIP]) → `router.sendResponse()`
10. Log to `proactive_log`, mark intent/trigger executed

**Meta-prompt template:**

```
[PROACTIVE FOLLOW-UP]
You registered an intent {timeAgo}: "{what}"
Reason: "{why}"

User: {name} ({channelId})
Timezone: {timezone} (current local: {localTime})
Last active: {lastSeenAgo}
Your quota: {remaining}/{max} proactive messages today
Your engagement rate: {rate}% of proactive messages get replies

Recent memories about this user:
{memories}

Decide: Should you follow up now? If yes, use any tools you need
(send_message, vault_remember, canvas_update, etc.).
If not worth it right now, respond with just: [SKIP]
If you want to defer to later, respond with: [DEFER {hours}h]
```

### 3. Config (`src/proactive/types.ts` + config changes)

```typescript
export interface ProactiveConfig {
  readonly enabled: boolean;
  readonly pollIntervalMs: number;          // Default: 60_000 (1 min)
  readonly passiveScanIntervalMs: number;   // Default: 21_600_000 (6h)
  readonly softQuotas: {
    readonly perUserPerDay: number;          // Default: 3
    readonly globalPerDay: number;           // Default: 100
  };
  readonly dormancy: {
    readonly enabled: boolean;
    readonly thresholdMs: number;            // Default: 604_800_000 (7 days)
  };
  readonly intentDefaults: {
    readonly minDelayMs: number;             // Default: 3_600_000 (1h)
    readonly maxAgeMs: number;              // Default: 604_800_000 (7 days)
    readonly defaultConfidence: number;      // Default: 0.8
    readonly confidenceThreshold: number;    // Default: 0.5
  };
  readonly quietHours: {
    readonly start: number;                  // Default: 22 (10 PM)
    readonly end: number;                    // Default: 8 (8 AM)
  };
}
```

---

## Plugin Integration

### 7 New Tools

| Tool | Purpose |
|------|---------|
| `proactive_intent` | AI registers a follow-up intent |
| `proactive_cancel` | AI cancels a pending intent |
| `proactive_list` | AI sees pending intents + triggers |
| `proactive_quota` | AI checks quota + engagement rate |
| `proactive_scan` | Force passive scan now |
| `proactive_execute` | Fire a specific intent immediately |
| `proactive_engage` | Record user engagement with proactive message |

### System Prompt Injection

In the existing `experimental.chat.system.transform` hook, inject proactive awareness:

```
You have proactive intelligence. When appropriate, use proactive_intent
to schedule follow-ups. Your current quota: {remaining}/{max} proactive
messages today. Engagement rate: {rate}%.
Pending intents: {count} follow-ups scheduled.
```

### 6 New Tool Server Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/proactive/intent` | Register intent |
| POST | `/proactive/cancel` | Cancel intent |
| GET | `/proactive/pending` | List pending intents + triggers |
| GET | `/proactive/quota` | Get quota status |
| POST | `/proactive/scan` | Force passive scan |
| POST | `/proactive/execute` | Fire intent now |

---

## Engagement Self-Tuning

The system tracks whether proactive messages get user replies:

1. Proactive message sent → `proactive_log` entry with `engaged=0`
2. User replies within 24h → MessageRouter detects reply in proactive session → `engaged=1`
3. Engagement rate computed: `COUNT(engaged=1) / COUNT(*) WHERE sent_at > now-30d`
4. Rate injected into AI system prompt → AI self-regulates
5. High engagement → AI more willing to be proactive
6. Low engagement → AI naturally holds back

---

## Safety Guardrails

1. **Soft quotas visible to AI** — AI sees quota in system prompt, decides responsibly
2. **Governance directives** — "Be conservative. Only follow up if genuinely valuable."
3. **AI re-evaluation gate** — Every intent goes through AI. AI can decline.
4. **Timezone awareness** — Skip if outside quiet hours (configurable, default 10PM-8AM)
5. **Confidence threshold** — Intents below 0.5 auto-skipped
6. **Max age expiry** — Intents older than 7 days auto-expire
7. **Engagement feedback** — Low rate → AI becomes conservative
8. **[SKIP] and [DEFER]** — AI can explicitly decline or postpone

---

## Files Changed

| Action | File | What |
|--------|------|------|
| CREATE | `src/proactive/store.ts` | IntentStore |
| CREATE | `src/proactive/engine.ts` | PulseEngine |
| CREATE | `src/proactive/types.ts` | Interfaces + config types |
| MODIFY | `src/vault/db.ts` | 3 new tables in schema |
| MODIFY | `src/vault/store.ts` | `listDormantProfiles()` |
| MODIFY | `src/config/types.ts` | `ProactiveConfig` in IrisConfig |
| MODIFY | `src/config/schema.ts` | `proactiveSchema` validation |
| MODIFY | `src/gateway/lifecycle.ts` | Wire IntentStore + PulseEngine |
| MODIFY | `src/bridge/tool-server.ts` | 6 new endpoints + deps |
| MODIFY | `.opencode/plugin/iris.ts` | 7 tools + system prompt injection |
| MODIFY | `AGENTS.md` | Proactive tools documentation |
| MODIFY | `docs/cookbook.md` | Proactive usage examples |

Estimated: ~400-500 lines new code (3 files), ~150 lines modifications (9 files).
