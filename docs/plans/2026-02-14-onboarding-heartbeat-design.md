# Onboarding & Heartbeat Design

## The Living Profile (Onboarding)

Two-layer onboarding that happens invisibly through natural conversation. The profile is never "complete" — it's always learning.

### Layer 1: Chameleon (First Contact)

When a user sends their first-ever message, the AI receives a meta-prompt injected into the conversation:

```
[FIRST CONTACT — NEW USER]
This user just messaged you for the first time.
Their message: "{text}"
Channel: {channelId}

Welcome them naturally. Learn about them through conversation, not interrogation.
Don't announce you're "onboarding" them. Just be genuinely curious.
Pick up on cues from their message — if they ask a technical question, help first, get to know them second.
```

**Detection:** MessageRouter checks `first_seen` on the vault profile. If the profile was just created (within last 30s of the current upsert), it's a first contact.

**No state machine.** No onboarding "flow." The AI handles it naturally. The meta-prompt is injected once, for the first message only.

### Layer 2: Ghost (Silent Progressive Profiling)

A `ProfileEnricher` runs on every inbound message, silently extracting behavioral signals:

| Signal Type | How Detected | Example |
|-------------|-------------|---------|
| `timezone` | Message timestamps clustered by hour | Messages at 9-17 UTC+2 → Europe/Chisinau |
| `language` | Text analysis (simple heuristics) | "Salut" → Romanian, "Привет" → Russian |
| `name` | Self-introduction patterns | "I'm Alex" → name: Alex |
| `response_style` | Message length patterns | Short messages → prefers concise replies |
| `active_hours` | Message time distribution | Most active 10:00-14:00 |
| `topics` | Keyword extraction from messages | Repeated "docker", "kubernetes" → devops interest |

**Storage:** New `profile_signals` table:

```sql
CREATE TABLE profile_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  observed_at INTEGER NOT NULL
);
CREATE INDEX idx_signals_sender ON profile_signals(sender_id, signal_type);
```

**Consolidation:** Every hour (configurable), signals are aggregated and merged into `vault_profiles`. High-confidence signals overwrite, low-confidence ones accumulate until they reach threshold.

**Profile fields enriched:** `timezone`, `language`, `preferred_name`, `response_style`, `active_hours_json`, `topics_json` — added to existing `vault_profiles` table.

## The Pulse (Heartbeat)

Adaptive health engine that monitors Iris's vital signs and self-heals before problems become visible.

### Adaptive Scheduling

```
All healthy   → tick every 60s  (minimal overhead)
Any degraded  → tick every 15s  (closer watch)
Any down      → tick every 5s   (rapid recovery monitoring)
After heal    → gradual backoff over 3 clean ticks
```

### 6 Health Checkers

Each checker runs in parallel every tick and returns a `HealthResult`:

```typescript
interface HealthResult {
  component: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  details?: string;
}
```

| Checker | Monitors | Self-Healing Action |
|---------|----------|-------------------|
| `BridgeChecker` | OpenCode process alive, responsive | Restart bridge connection |
| `ChannelChecker` | Each adapter connected | Auto-reconnect channel |
| `VaultChecker` | SQLite integrity, FTS5 index | VACUUM, rebuild index |
| `ProactiveChecker` | PulseEngine running, stuck intents | Restart engine, unstick intents |
| `SessionChecker` | Stale/orphaned sessions | Clean up stale sessions |
| `MemoryChecker` | Process heap size, RSS | Force GC, warn if growing |

### Health State Machine

```
healthy → degraded → down → recovering → healthy
                                ↑
                         (self-heal succeeds)
```

- State tracked per component in memory
- Transitions logged to `heartbeat_log` table
- After 3 failed heal attempts → stop trying, log critical

### Self-Healing Pipeline

1. Checker detects degraded/down
2. Look up healing strategy for component
3. Execute healing action (reconnect, restart, cleanup)
4. Log action to `heartbeat_actions` table
5. Wait one tick, re-check
6. Healed → `recovering` → 3 clean ticks → `healthy`
7. Still down after 3 attempts → give up, log critical

### Activity Tracking

Piggybacks on the heartbeat loop for user engagement:

- Records message timestamps per user (lightweight counter, not content)
- Computes: messages/hour, active hours, dormancy risk score
- Feeds PulseEngine for dormancy triggers
- No separate table — extends `vault_profiles` with:
  - `last_message_at` (already exists)
  - `message_count_7d` (rolling 7-day count)
  - `dormancy_risk` (0.0-1.0 computed score)

### Storage

```sql
CREATE TABLE heartbeat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  details TEXT,
  checked_at INTEGER NOT NULL
);
CREATE INDEX idx_heartbeat_component ON heartbeat_log(component, checked_at);

CREATE TABLE heartbeat_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  action TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  executed_at INTEGER NOT NULL
);
CREATE INDEX idx_actions_component ON heartbeat_actions(component, executed_at);
```

## Integration

```
Inbound Message
  │
  ├─→ SecurityGate (existing)
  │     │
  │     ├─→ ProfileEnricher (Ghost — every message)
  │     │     └─→ vault_profiles + profile_signals
  │     │
  │     ├─→ First Contact? → Inject onboarding meta-prompt (Chameleon)
  │     │
  │     └─→ MessageRouter (existing flow continues)
  │
  ├─→ HeartbeatEngine (independent loop)
  │     ├─→ 6 checkers → self-heal → log
  │     ├─→ ActivityTracker → dormancy risk → PulseEngine
  │     └─→ Health status via tool endpoint
  │
  └─→ PulseEngine (existing, enhanced)
        ├─→ Dormancy triggers fed by ActivityTracker
        └─→ Onboarding follow-up (if user goes silent after first contact)
```

**Integration points:**
1. `ProfileEnricher` hooks into `lifecycle.ts` at existing `vaultStore.upsertProfile` call (~line 299)
2. First contact detection checks `first_seen` on profile — if just created = new user
3. `HeartbeatEngine` initialized in lifecycle alongside PulseEngine — independent lifecycle
4. `ActivityTracker` owned by HeartbeatEngine, exposed via tool endpoint
5. Onboarding meta-prompt injected in MessageRouter, not plugin system prompt hook

## Configuration

```yaml
onboarding:
  enabled: true
  enricher:
    enabled: true
    signalRetentionDays: 90
    consolidateIntervalMs: 3600000  # 1hr
  firstContact:
    enabled: true

heartbeat:
  enabled: true
  intervals:
    healthy: 60000      # 60s
    degraded: 15000     # 15s
    critical: 5000      # 5s
  selfHeal:
    enabled: true
    maxAttempts: 3
    backoffTicks: 3
  activity:
    enabled: true
    dormancyThresholdMs: 604800000  # 7 days
  logRetentionDays: 30
```

## New Files

- `src/onboarding/enricher.ts` — ProfileEnricher class
- `src/onboarding/signals.ts` — SignalStore (profile_signals table)
- `src/onboarding/types.ts` — Signal types, enricher config
- `src/heartbeat/engine.ts` — HeartbeatEngine class
- `src/heartbeat/checkers.ts` — 6 health checker implementations
- `src/heartbeat/store.ts` — HeartbeatStore (log + actions tables)
- `src/heartbeat/activity.ts` — ActivityTracker class
- `src/heartbeat/types.ts` — Health states, checker interfaces

## Modified Files

- `src/gateway/lifecycle.ts` — initialize onboarding + heartbeat
- `src/bridge/message-router.ts` — first contact detection + meta-prompt injection
- `src/bridge/tool-server.ts` — heartbeat status endpoint
- `.opencode/plugin/iris.ts` — heartbeat_status tool
- `src/config/types.ts` — new config sections
- `AGENTS.md` — onboarding + heartbeat docs

## Safety

- ProfileEnricher stores behavioral signals only (no message content, no sensitive data)
- Self-healing capped at 3 attempts per component — no infinite loops
- Both systems fully optional and degrade gracefully
- First contact meta-prompt additive — doesn't override governance or safety
