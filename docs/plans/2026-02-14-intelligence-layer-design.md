# Iris v2: Intelligence Layer Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add connective tissue between Iris's existing subsystems — turning independent perception/memory/action into a continuous sense-think-act feedback loop.

**Architecture:** A new `src/intelligence/` directory housing the reasoning loop. Four phases, each independently shippable. All new code is deterministic Node.js + SQLite. Zero LLM cost for new layers.

**Tech Stack:** Node.js, SQLite (better-sqlite3), TypeScript, Vitest

---

## Constraints

- Zero LLM cost for all new layers (deterministic logic only)
- Evolve in-place (same repo, same build)
- All new tables in existing vault.db
- Intelligence Bus is synchronous, in-process (<5ms per message)
- Existing tests must not break

## Phase 1: Signal Inference Engine + Event-Driven Triggers

Foundation layer. Inference produces understanding from raw signals. Triggers act on events in real-time.

### Phase 2: Outcome-Aware Proactive Loop + Memory Arcs

Learning layer. Outcomes segment proactive feedback by category. Arcs add temporal narrative to vault memories.

### Phase 3: Goal Tracking + Cross-Channel Intelligence

Agency layer. Goals give Iris persistent objectives across turns. Cross-channel exploits the unified vault.

### Phase 4: Self-Tuning Heartbeat + Intelligence Bus Integration

Polish layer. Trend detection predicts degradation. Health gate throttles proactive. Bus connects everything.

## Estimated Scope

~30 new files, ~5300 LOC, ~15 test files, ~2000 LOC tests.
