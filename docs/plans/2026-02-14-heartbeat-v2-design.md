# Heartbeat V2: Six OpenClaw Advantages for Iris

## Context

Iris has infrastructure health monitoring with self-healing. OpenClaw has a battle-tested heartbeat runner (942 lines) with features Iris lacks. This design brings the best of OpenClaw to Iris without losing what makes Iris unique (adaptive intervals, self-healing, component-level granularity).

## Features

### 1. Active Hours Gating
Timezone-aware window (e.g., 09:00-22:00 Europe/Chisinau). Skip health checks outside window. Uses `Intl.DateTimeFormat` for IANA timezone resolution, falls back to UTC on invalid timezone.

### 2. Per-Channel Visibility
Control which channels see health status/alerts. Three flags: `showOk` (silent OK acks), `showAlerts` (alert delivery), `useIndicator` (UI status events). Layered config: global defaults -> per-channel overrides.

### 3. Deduplication
Don't send the same alert twice within a configurable window (default 24h). Track last alert text per component+agent in SQLite. Compare trimmed text before emitting.

### 4. Empty-Check + Exponential Backoff
Hash all component statuses. If hash matches previous tick AND all healthy, skip the full check. Additionally, exponentially back off the healthy interval (60s -> 120s -> 240s up to configurable cap). Maximum resource savings when everything is fine.

### 5. Full Multi-Agent Independence
Each agent gets its own heartbeat schedule, state map, and config overrides. Independent intervals, lastRun, nextDue per agent. Single timer schedules the earliest-due agent. Defaults to single "default" agent if no agents array in config.

### 6. Coalescing + Queue Awareness
Debounce rapid heartbeat requests (250ms window). Check OpenCodeBridge in-flight prompt count before running. If queue busy, defer and retry after 1s.

## Architecture

### Approach: Modular Companions
Engine remains orchestrator. Each feature is a separate module (pure function or small class). Engine imports and composes them. Matches existing Iris patterns (checkers are already separate modules).

### New Files
- `src/heartbeat/active-hours.ts` — `isWithinActiveHours()` pure function
- `src/heartbeat/visibility.ts` — `resolveVisibility()` pure function
- `src/heartbeat/empty-check.ts` — `shouldSkipEmptyCheck()` with backoff calc
- `src/heartbeat/coalesce.ts` — `HeartbeatCoalescer` class with debounce + queue gate

### Modified Files
- `src/heartbeat/types.ts` — ActiveHoursConfig, VisibilityConfig, EmptyCheckConfig, HeartbeatAgentConfig
- `src/heartbeat/store.ts` — heartbeat_dedup table, agent_id columns, isDuplicate(), recordAlert()
- `src/heartbeat/engine.ts` — multi-agent state map, integrate all modules
- `src/config/schema.ts` — extend heartbeatSchema with new Zod schemas
- `src/config/types.ts` — export new interfaces
- `src/bridge/opencode-client.ts` — inFlightPrompts counter, getQueueSize()
- `src/gateway/lifecycle.ts` — pass getQueueSize + userTimezone to engine
- `src/bridge/tool-server.ts` — update /heartbeat/status response shape (breaking: adds agentId)
- `.opencode/plugin/iris.ts` — update heartbeat_status, add heartbeat_trigger tool

### Data Flow
```
Timer fires -> HeartbeatEngine.tickAll()
  -> for each agent where now >= nextDueMs:
    -> isWithinActiveHours() -- skip if outside window
    -> shouldSkipEmptyCheck() -- skip if all healthy + unchanged + backoff
    -> coalescer.requestRun()
      -> debounce 250ms
      -> bridge.getQueueSize() > 0 ? retry 1s : proceed
      -> checkers.map(c => c.check()) in parallel
      -> for each result:
        -> store.logCheck({..., agentId})
        -> update componentState
        -> if status changed to unhealthy:
          -> store.isDuplicate() -- skip if same alert within 24h
          -> resolveVisibility() -- skip if showAlerts=false for this channel
          -> emit alert + store.recordAlert()
      -> self-healing pass (per-agent)
      -> reschedule: adaptive interval + exponential backoff if all healthy
```

## Config Schema

```yaml
heartbeat:
  enabled: true
  intervals: { healthy: 60000, degraded: 15000, critical: 5000 }
  selfHeal: { enabled: true, maxAttempts: 3, backoffTicks: 3 }
  activity: { enabled: true, dormancyThresholdMs: 604800000 }
  logRetentionDays: 30

  # New features (all optional)
  activeHours:
    start: "09:00"
    end: "22:00"
    timezone: "Europe/Chisinau"
  visibility:
    showOk: false
    showAlerts: true
    useIndicator: true
  channelVisibility:
    telegram: { showAlerts: false }
  dedupWindowMs: 86400000
  emptyCheck:
    enabled: true
    maxBackoffMs: 300000
  coalesceMs: 250
  retryMs: 1000
  agents:
    - agentId: "production"
      intervals: { healthy: 30000 }
      activeHours: { start: "08:00", end: "23:00" }
    - agentId: "staging"
      intervals: { healthy: 120000 }
```

## Database Changes

```sql
-- Add agent_id to existing tables (ALTER TABLE with DEFAULT is safe in SQLite)
-- heartbeat_log: agent_id TEXT DEFAULT 'default'
-- heartbeat_actions: agent_id TEXT DEFAULT 'default'

-- New dedup table
CREATE TABLE IF NOT EXISTS heartbeat_dedup (
  component TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'default',
  last_alert_text TEXT NOT NULL,
  last_sent_at INTEGER NOT NULL,
  PRIMARY KEY (component, agent_id)
);
```

## Build Sequence

### Phase 1: Pure Modules (no existing code changes)
1. active-hours.ts + tests
2. visibility.ts + tests
3. empty-check.ts + tests
4. coalesce.ts + tests

### Phase 2: Storage + Config (additive)
5. store.ts — dedup table, agent_id columns, new methods
6. types.ts — new config interfaces
7. schema.ts — extend Zod schema

### Phase 3: Bridge (minimal)
8. opencode-client.ts — queue size tracking

### Phase 4: Engine Refactor (breaking)
9. engine.ts — multi-agent + feature integration
10. lifecycle.ts — wire new deps
11. tool-server.ts — update response shape

### Phase 5: Plugin + Docs
12. iris.ts plugin — update tool, add heartbeat_trigger
13. AGENTS.md + cookbook.md
14. Update existing heartbeat tests

## Breaking Changes

- `HeartbeatEngine.getStatus()` returns `{ agentId, component, status }[]` instead of `{ component, status }[]`
- `/heartbeat/status` endpoint response adds `agentId` field per component
- `HeartbeatEngineDeps` interface adds optional `getQueueSize` and `userTimezone` fields

## Risks

| Risk | Mitigation |
|------|-----------|
| Multi-agent scheduling bugs | Default to single "default" agent; existing configs unchanged |
| Timezone parsing fails | Fallback to UTC, log warning |
| Dedup false positives | Configurable window, text trim comparison |
| Empty-check misses issues | Disabled by default initially, opt-in |
| Exponential backoff too aggressive | Configurable cap (maxBackoffMs), reset on any non-healthy |
| SQLite ALTER TABLE fails | Use IF NOT EXISTS patterns, test migration |
