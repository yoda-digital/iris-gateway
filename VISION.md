# VISION.md — iris-gateway Architecture Vision

This document is the law. Not a suggestion. Not a guide. The law.

If your PR violates what's written here, it gets rejected. If you think something here is wrong, open an issue and argue your case. Don't just ignore it.

---

## What This Repo Is

`iris-gateway` is the operational backbone connecting AI agents (OpenCode plugin) to the real world — channels (Telegram, WhatsApp), persistence (SQLite, vault), intelligence (inference, goals, arcs), and tooling (CLI bridge, skill execution).

It is **not** a general-purpose bot framework. It is not a library. It is not a platform for experiments. It is a production system with real operational requirements.

---

## Architecture Principles

### 1. Single-Responsibility, Without Exceptions

Every file has one job. Not one job plus a few helpers.

**Hard limit: 500 lines per file. No exceptions. No "but it's complicated".**

If you're approaching 500 lines, you haven't decomposed the problem. Stop. Think. Split.

### 2. The Bridge Architecture

iris-gateway runs two processes:
1. **Gateway process** (`src/`) — HTTP servers (port 19876 health, port 19877 tools), channel adapters, intelligence layer, persistence
2. **Plugin process** (`.opencode/plugin/`) — OpenCode plugin that calls gateway over HTTP

The boundary between them is the tool-server API on port 19877. This boundary must stay clean:
- Gateway never imports plugin code
- Plugin only communicates via HTTP to `localhost:19877`
- All inter-process contracts are HTTP+JSON, documented in `docs/tool-api.md`

### 3. Model Selection Is Configuration, Not Code

The git log is a graveyard of model switches: trinity-large-preview → llama-3.3-70b → glm-4.5-air → step-3.5-flash → aurora-alpha → gpt-oss-120b.

Every single one of those was a code change. Every single one triggered a release cycle. This is insane.

**Rule:** No model identifier appears in source code. Ever.

All model configuration lives in `iris.config.json` under the `models` section. The application reads this at startup. Switching models = edit config + restart. Zero code changes, zero commits, zero releases.

### 4. Tests Are Not Optional

The test suite exists for a reason. Failing tests are not "known issues" — they are bugs in the test or bugs in the code. Fix them. Delete them if they're wrong. But don't normalize failure.

**Rules:**
- `pnpm test` must exit 0 on every commit to main
- No PR merged with failing tests
- Coverage floor: 75%. Don't let it drop.
- New features ship with tests. No exceptions.

### 5. Domain Ownership

Each subsystem owns its data. The fact that everything shares a SQLite file does not mean everything shares a store class.

`src/intelligence/store.ts` has been split into domain-scoped stores:
- `src/intelligence/inference/store.ts` — derived_signals, inference_log
- `src/intelligence/outcomes/store.ts` — proactive_outcomes
- `src/intelligence/arcs/store.ts` — memory_arcs, arc_entries
- `src/intelligence/goals/store.ts` — goals

Database connection is shared via dependency injection. Store classes are not.

### 6. Dependency Direction

```
channels/     →  gateway core
intelligence/ →  gateway core
bridge/       →  gateway core + intelligence + channels
gateway/      →  everything (composition root)
plugin/       →  nothing (reads via HTTP only)
```

No circular dependencies. No importing from a higher layer. If you need something from a higher layer, you're designing it wrong — invert the dependency.

---

## What Belongs Here

✅ Channel adapters (Telegram, WhatsApp, future channels)
✅ Tool server (HTTP bridge for OpenCode plugin)
✅ Intelligence layer (inference, goals, arcs, outcomes)
✅ Vault operations (read/write/search)
✅ Governance and policy enforcement
✅ Health monitoring
✅ CLI tool bridge

❌ Business logic specific to a single user's configuration
❌ Model training or fine-tuning
❌ General-purpose HTTP server features
❌ Frontend / UI code
❌ Anything that should be a separate service

---

## Milestone Roadmap

### v1.1 — Stability & Test Integrity (in progress — 89% complete)
The test suite is green (1626/1626 passing, 90.6% stmt / 88.8% branch / 87.8% function coverage).

- ✅ Fixed 6 pre-existing test failures (issue #1)
- ✅ Split tool-server.ts into domain routers (issue #2)
- ✅ Decomposed iris.ts plugin (issue #3)
- ✅ Model selection in config only (issue #4)
- ⏳ 5 issues remaining (coverage gaps: bridge/cli.ts, security-wiring.ts, message-router.ts, OutcomesStore — see milestone v1.1 on GitHub)

### v1.2 — Architecture Hardening (due 2026-06-30)
Clean layers. Documented APIs. Resilient connections.

- Split lifecycle.ts (issue #5)
- Split IntelligenceStore (issue #6)
- Harden WhatsApp reconnect (issue #7)
- Document tool API (issue #8)
- Improve intelligence layer test coverage (issue #9)

### v2.0 — Platform Evolution (due 2026-12-31)
Platform-quality: metrics, SDK, multi-instance.

- ✅ Plugin SDK for external developers — `IrisClient` published as `@yoda.digital/iris-gateway/sdk` (closes #100)
- ✅ Multi-instance support — shared SQLite WAL + advisory leader election via `InstanceCoordinator` (closes #101)
- ✅ Distributed architecture investigation — spike complete (closes #104)
- ⏳ Prometheus metrics endpoint (issue #10) — remaining work

---

## Release Cadence

- **Patch releases** (`x.x.N`): bug fixes only, can ship anytime, must be green
- **Minor releases** (`x.N.0`): features, must close milestone, must be fully green
- **Major releases** (`N.0.0`): breaking changes, require architecture review

semantic-release handles versioning. Conventional commits are enforced. Don't fight this — it works.

---

## Non-Negotiable Quality Standards

| Standard | Rule |
|----------|------|
| File size | Hard limit: 500 lines. No exceptions. |
| Test suite | `pnpm test` exits 0. Always. |
| Coverage | Minimum 75%. Don't let it drop. |
| Model config | No model identifiers in source code. |
| Known failures | This category does not exist. Fix or delete. |
| Commit format | Conventional commits. semantic-release validates. |
| PR merges | No failing tests. No files over 500 lines in the diff. |

---

*This document was created 2026-03-03 as part of the iris-gateway ATL bootstrap.*
*It will be updated as the architecture evolves. Propose changes via issues.*
