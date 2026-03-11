# ADR: Distributed Architecture for iris-gateway v2.0

**Status:** Proposed  
**Date:** 2026-03-11  
**Issue:** [#104](https://github.com/yoda-digital/iris-gateway/issues/104)  
**Depends on:** None  
**Blocks:** [#101](https://github.com/yoda-digital/iris-gateway/issues/101) (multi-instance implementation)

---

## Context

VISION.md v2.0 lists "Distributed architecture investigation" as a prerequisite before multi-instance implementation (#101). This ADR documents the options, tradeoffs, benchmark data, and recommended path.

iris-gateway currently runs as a single process: one Gateway (ports 19876/19877) + one Plugin process. All state lives in a local SQLite file (`~/.iris/vault.db`) using WAL mode.

The question: can iris-gateway scale horizontally, and if so — how?

---

## Problem Areas

### 1. SQLite WAL Write Contention

**Benchmark (2026-03-11, WSL2/Linux 6.6.87, ext4):**

| Scenario | Writers | Inserts | Conflicts | Throughput | Avg Latency | P50 (Median) | Max |
|----------|---------|---------|-----------|------------|-------------|--------------|-----|
| Low load | 4 | 400 | 0 (0%) | ~248/s | 9.74ms | 4.95ms | 1237ms |
| High load | 8 | 1600 | 8 (0.5%) | 303/s | 8.92ms | 5.71ms | 1937ms |

**Findings:**
- WAL mode handles concurrent readers with zero conflict
- Write conflicts are rare (0.5% at 8 concurrent writers) but max latency spikes to ~2s
- Single-writer constraint is SQLite's hard limit — only one writer holds the lock at a time
- For iris-gateway's write patterns (intelligence ticks, message persistence, cron events), ~300 writes/sec is sufficient for a single instance
- **Multi-instance on the same SQLite file is not viable** — filesystem locks don't work across network mounts, and write serialization would become a bottleneck at 3+ instances

### 2. Message Routing in Multi-Instance

Each instance handles a subset of sessions. A message arriving at instance A for a session owned by instance B requires routing.

**Options:**

**a) Session Affinity (sticky routing)**
- Load balancer routes session ID → fixed instance
- Simple: no cross-instance message forwarding
- Failure: if instance A dies, sessions migrate with reconnect overhead
- Best for: predictable load, non-critical failover

**b) Shared Coordination (Redis pub/sub)**
- All instances subscribe to a shared bus
- Any instance can handle any session
- Requires Redis as infrastructure dependency
- Adds ~1ms network hop per message
- Best for: HA requirements, zero-downtime deploys

**c) Gateway Mesh (direct instance-to-instance HTTP)**
- Instance A forwards to instance B via HTTP
- No external dependency
- O(n²) connections at scale, complex failure modes
- Not recommended for iris-gateway scale

### 3. Cron/Intelligence Deduplication

iris-gateway runs periodic jobs: heartbeats, proactive intelligence (PI) ticks, cleanup crons. In multi-instance, these would fire N times unless deduplicated.

**Options:**

**a) Leader election (SQLite-based)**
- Each instance races to insert a `leader_lease` row with expiry
- Only leader runs crons
- Works with shared SQLite or shared Redis
- Failure: leader death → up to `lease_ttl` seconds of no crons

**b) External lock (Redis SETNX + TTL)**
- Standard distributed lock pattern
- 1-5s TTL, auto-release on failure
- Requires Redis

**c) External cron (cron daemon, not in-process)**
- Move cron execution outside iris-gateway
- Instances become stateless workers
- Best for true horizontal scaling (v3.0+)
- Complexity: operational overhead of external scheduler

### 4. Vault (SQLite) Write Contention Analysis

Vault operations (`vault_search`, `vault_write`, `vault_read`) interact with the configured vault backend (e.g., a local notes directory via a vault plugin), not `vault.db` directly. These are **read-heavy** and low-frequency. Write contention here is negligible.

For `vault.db` (pipeline state, intelligence store):
- Current write pattern: ~5-20 writes/minute under normal load
- Peak: ~60-100 writes/minute during message storms
- WAL benchmark shows this is well within single-instance capacity
- Multi-instance would require one of: libSQL, Redis, or external DB

---

## Options Evaluated

### Option A: libSQL / Turso

**What it is:** Drop-in SQLite replacement ([tursodatabase/libsql](https://github.com/tursodatabase/libsql)) with embedded replication and multi-writer support via Turso cloud or self-hosted sqld.

**Pros:**
- API-compatible with better-sqlite3 (migration is `npm install @libsql/client` + connection string change)
- Supports remote replicas — instances can read locally, write to primary
- No new infrastructure for single-region (use embedded mode)
- Turso cloud option for zero-ops

**Cons:**
- `@libsql/client` API differs slightly from `better-sqlite3` (async vs sync)
- Self-hosted `sqld` adds operational complexity
- Turso cloud adds cost and external dependency
- Replication lag (eventual consistency) — intelligence reads might see stale state

**Verdict:** Good choice for v2.0 if multi-instance is required. Embedded mode works without Turso. Migration effort: ~2-3 days.

### Option B: Redis as Coordination Layer

**What it is:** Keep SQLite for persistence, add Redis for distributed coordination (locks, pub/sub, ephemeral state).

**Pros:**
- SQLite stays for durable state (no migration)
- Redis handles cron deduplication, session routing, leader election cleanly
- Standard pattern, well-understood failure modes
- `ioredis` is mature and battle-tested

**Cons:**
- New infrastructure dependency (Redis process or Redis Cloud)
- Adds operational complexity for deployment
- Two systems to backup/monitor
- Overkill if iris-gateway runs 2-3 instances max

**Verdict:** Best choice if HA is a hard requirement. Adds ~2-4 hours of infrastructure setup.

### Option C: Process-Level Isolation (No Distribution)

**What it is:** Each iris-gateway instance gets its own SQLite file and serves disjoint users. No shared state. No cross-instance routing.

**Pros:**
- Zero architecture changes
- No new dependencies
- Works today
- Isolation = fault containment

**Cons:**
- Not "multi-instance" in the HA sense — just N independent installs
- Users can't migrate between instances without data export
- No failover

**Verdict:** Valid for horizontal scaling by partitioning users. Not valid for HA.

---

## Recommendation

**For v2.0: Option C (Process Isolation) as default, Option A (libSQL embedded) as opt-in upgrade path.**

### Rationale

1. **iris-gateway is not a high-traffic system.** Benchmark shows WAL handles current and projected load on a single instance. The 0.5% conflict rate at 8 concurrent writers is acceptable, and iris-gateway will never hit 8 concurrent writers in production.

2. **Operational simplicity wins.** Adding Redis or migrating to libSQL for 2-3 instances introduces failure modes that cost more to operate than they save in availability.

3. **Session affinity is sufficient.** If multi-instance is needed (e.g., separate instances per environment or per user group), a simple reverse proxy with consistent hashing by user ID provides session affinity with zero code changes.

4. **libSQL is the right bet for v2.0+ if true HA is needed.** The API compatibility means the migration is low-risk. Recommend implementing libSQL support behind a config flag (`persistence.driver: "libsql" | "sqlite"`) so it can be enabled without breaking existing deployments.

5. **Cron deduplication:** Implement SQLite-based leader election (Option 3a) using `intelligence_meta` table. Simple, no new dependencies, solves the duplicate-cron problem for 2-3 instances.

### Implementation Path for #101

1. **Phase 1 (v2.0):** Process isolation — document that each instance is independent. No code changes needed. Update deployment docs.

2. **Phase 2 (v2.1, optional):** Add libSQL driver behind config flag. Cron deduplication via leader lease in SQLite/libSQL.

3. **Phase 3 (v3.0, if needed):** Redis coordination layer for true HA. Only if Phase 2 proves insufficient.

---

## Decision

**Chosen path: Process Isolation (Option C) for v2.0, libSQL embedded as upgrade path.**

This ADR unblocks issue #101. Multi-instance implementation should document the process-isolation model and add a `MULTI_INSTANCE.md` in `docs/deployment/` covering:
- How to run N independent instances
- Reverse proxy configuration for session affinity
- Shared nothing architecture
- Data migration between instances

---

## References

- [libSQL GitHub](https://github.com/tursodatabase/libsql)
- [SQLite WAL documentation](https://www.sqlite.org/wal.html)
- [Redis SETNX distributed locks](https://redis.io/docs/manual/patterns/distributed-locks/)
- VISION.md v2.0 section
- Issue #101: Multi-instance support
- Benchmark data: collected 2026-03-11, 4-8 concurrent writers, SQLite WAL, WSL2 ext4
