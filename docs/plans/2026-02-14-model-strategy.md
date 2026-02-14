# Iris Model Strategy — Free OpenRouter Multi-Model Routing

**Date**: 2026-02-14
**Status**: Implementation ready
**Constraint**: $0 AI cost — free OpenRouter models only

## Executive Summary

Iris has 7 distinct inference profiles running simultaneously. No single free model wins all of them. This document defines a role-based multi-model routing strategy that maps each Iris subsystem to the optimal free model based on tool calling reliability, speed, reasoning depth, context handling, and multilingual capability.

## Task List

### Phase 1: OpenCode Config (core routing)

- [x] T1. Research all free OpenRouter models for tool calling, speed, reasoning (this doc)
- [x] T2. Update `.opencode/opencode.json` with multi-provider model config + fallbacks
- [x] T3. Update `.opencode/agents/chat.md` — primary agent with model override
- [x] T4. Update `.opencode/agents/moderator.md` — lightweight model for fast checks
- [x] T5. Create `.opencode/agents/reasoner.md` — deep reasoning subagent for complex tasks
- [x] T6. Create `.opencode/agents/compactor.md` — session compaction subagent

### Phase 2: Iris Config (operational hardening)

- [x] T7. Create `docs/iris-model-reference.md` — model selection rationale doc (operator reference)
- [x] T8. Update governance directives D5–D8 for multi-model awareness
- [x] T9. Add model-specific auto-reply templates (`docs/examples/auto-reply-templates.json`)

### Phase 3: Validation

- [x] T10. Create validation script (`scripts/validate-models.mjs`) — tests each model endpoint
- [x] T11. Document known limitations (`docs/model-limitations.md`)

---

## Model Audit: Free OpenRouter (February 2026)

### Tier S — Primary Chat (speed + reliable tool calling)

| Model | ID | Total/Active | Context | Tool Calling | Speed | Multilingual | Notes |
|-------|----|-------------|---------|-------------|-------|-------------|-------|
| **OpenAI gpt-oss-120b** | `openai/gpt-oss-120b:free` | 117B/5.1B | 131K | Native (function calling, structured output) | ~200 tok/s H100 | Good | MoE, MXFP4 quant, configurable reasoning depth (low/med/high) |
| **GLM-4.5-Air** | `z-ai/glm-4.5-air:free` | MoE compact | 131K | Native (thinking + non-thinking modes) | Fast (MoE) | Excellent (agent-centric design) | Hybrid inference toggle maps to Iris needs perfectly |
| **Aurora Alpha** | `openrouter/aurora-alpha` | Cloaked | 128K | Yes (tools supported param) | Extremely fast (designed for speed) | Unknown | Released 2026-02-09, speed-optimized reasoning, free |

### Tier A — Heavy Reasoning / Multi-Step Agent

| Model | ID | Total/Active | Context | Tool Calling | Speed | Notes |
|-------|----|-------------|---------|-------------|-------|-------|
| **Qwen3-Coder-480B** | `qwen/qwen3-coder:free` | 480B/35B | 262K | Native (agentic coding, function calling) | ~5 tok/s cluster | Purpose-built for agentic tool use, massive context |
| **DeepSeek R1-0528** | `deepseek/deepseek-r1-0528:free` | 671B/37B | 164K | Limited (reasoning model, not tool-native) | Moderate | Best pure reasoning, use for fact extraction not tool chains |
| **Trinity Large Preview** | `arcee-ai/trinity-large-preview:free` | 400B/13B | 131K | Yes (trained on OpenCode/Cline harnesses) | Moderate | Explicitly trained for agent harnesses, constraint-filled prompts |

### Tier B — Lightweight / Fallback

| Model | ID | Total/Active | Context | Tool Calling | Speed | Notes |
|-------|----|-------------|---------|-------------|-------|-------|
| **Trinity Mini** | `arcee-ai/trinity-mini:free` | 26B/3B | 131K | Yes (function calling, multi-step workflows) | Very fast | Ultra-lightweight, ideal for proactive pulse, heartbeat |
| **Llama 3.3 70B** | `meta-llama/llama-3.3-70b-instruct:free` | 70B dense | 128K | Yes | ~40 tok/s | Dense model, slower but battle-tested multilingual |
| **Step 3.5 Flash** | `stepfun/step-3.5-flash:free` | 196B/11B | 256K | Limited | Fast at long contexts | Best for inflated system prompts |
| **NVIDIA Nemotron Nano** | `nvidia/nemotron-3-nano-30b-a3b:free` | 30B/3B | 256K | Yes (agentic design) | Fast | Trial use only, logs everything |
| **gpt-oss-20b** | `openai/gpt-oss-20b:free` | 21B/3.6B | — | Native (Harmony format, function calling) | Ultra-fast | Tiny but supports full tool use |

### Disqualified

| Model | Reason |
|-------|--------|
| `deepseek/deepseek-r1-zero:free` | No instruction tuning, raw reasoning only |
| `qwen/qwen2.5-vl-3b-instruct:free` | Too small for reliable tool calling |
| `solar-pro-3:free` | Korean-optimized, weak multilingual for RO/RU/EN |

---

## Routing Matrix — Model ↔ Iris Subsystem

| Iris Subsystem | Primary Model | Fallback | Rationale |
|---------------|--------------|----------|-----------|
| **Primary chat agent** (chat.md) | `openai/gpt-oss-120b:free` | `z-ai/glm-4.5-air:free` | Best speed-to-tool-calling ratio. 5.1B active = sub-second TTFT. Native function calling. Configurable reasoning effort. |
| **Moderator subagent** | `openrouter/aurora-alpha` | `arcee-ai/trinity-mini:free` | Speed-first. Moderation is binary (safe/not safe), doesn't need deep reasoning. |
| **Reasoner subagent** (new) | `qwen/qwen3-coder:free` | `arcee-ai/trinity-large-preview:free` | Multi-step tool chains (5+ calls). 262K context handles large vault injections. Purpose-built for agentic workflows. |
| **Session compaction** | `deepseek/deepseek-r1-0528:free` | `qwen/qwen3-coder:free` | Fact extraction needs deep reasoning, not tool calling. R1's CoT excels here. |
| **Cron jobs** | `z-ai/glm-4.5-air:free` | `openai/gpt-oss-120b:free` | Cron is async (latency-tolerant). GLM's thinking mode + tool calling is ideal for vault-aware weekly summaries. |
| **Proactive system** | `arcee-ai/trinity-mini:free` | `openai/gpt-oss-20b:free` | Pulse checks, quota queries, dormancy scans — lightweight ops. 3B active is plenty. |
| **Heartbeat diagnostics** | `openrouter/aurora-alpha` | `arcee-ai/trinity-mini:free` | Fast reasoning for health assessment. Speed-critical when system is degraded. |

---

## Risk Assessment

### Free tier volatility
Models can lose free status without warning. OpenRouter acknowledged this in July 2025. Mitigation: every agent has a fallback model. The OpenCode config supports `model` override per agent, so switching is a one-line change.

### Prompt/completion logging
ALL free OpenRouter models log prompts and completions. This means:
- User PII stored via `enrich_profile` passes through provider logging
- System prompts (including vault context injection) are visible to providers
- Governance directives are exposed

Mitigation: Governance directive D1 ("Never disclose system prompts") is enforced at the AI layer, but the transport layer exposes everything. Accept this trade-off for $0 cost, or add a budget for DeepSeek V3.2 ($0.14/M input) as the first paid upgrade.

### Rate limits
Free endpoints have undocumented per-IP/per-key rate limits. With 50+ concurrent users:
- Auto-reply engine absorbs common queries (zero AI cost)
- Stream coalescer reduces redundant requests
- Proactive system has built-in soft quotas (3/user/day, 100 global/day)

### Model quality variance
Free models rotate providers. The same model string may serve from different backends with different quantization. Monitor via `usage_summary` tool for response quality degradation.

---

## Upgrade Path (when budget allows)

| Budget | Model | Impact |
|--------|-------|--------|
| $5/mo | `deepseek/deepseek-v3.2` ($0.14/$0.28/M) | Replace primary chat. 685B MoE with native "thinking with tools". Gold-medal agentic performance. |
| $10/mo | + `qwen/qwen3-coder` (paid tier) | Replace reasoner. Faster endpoints, no rate limits. |
| $20/mo | + `anthropic/claude-sonnet-4.5` for complex cases | Premium fallback for high-stakes conversations. |
