# Iris Model Configuration Reference

## Quick Reference: Active Model Assignments

| Agent | Model ID | Role | Speed | Tool Calling |
|-------|----------|------|-------|-------------|
| `chat` (primary) | `openai/gpt-oss-120b:free` | Main conversation | ★★★★★ | ★★★★☆ |
| `moderator` | `openrouter/aurora-alpha` | Content safety | ★★★★★ | ★★★☆☆ |
| `reasoner` | `qwen/qwen3-coder:free` | Complex multi-step | ★★☆☆☆ | ★★★★★ |
| `compactor` | `deepseek/deepseek-r1-0528:free` | Fact extraction | ★★★☆☆ | ★★☆☆☆ |
| `small_model` | `arcee-ai/trinity-mini:free` | Titles, summaries | ★★★★★ | ★★★☆☆ |

## How to Switch Models

### Per-agent override (recommended)
Edit the agent's markdown frontmatter in `.opencode/agents/<name>.md`:
```yaml
---
model: openrouter/<provider>/<model-id>:free
---
```

### Global override
Edit `.opencode/opencode.json`:
```json
{
  "model": "openrouter/<provider>/<model-id>:free"
}
```
This changes the default for all agents that don't have a per-agent override.

### Runtime switching
Use the OpenCode `/models` command to switch models during a live session.

## Fallback Chain

If the primary model is unavailable (rate limited, provider down), switch to:

| Agent | Primary | Fallback 1 | Fallback 2 |
|-------|---------|-----------|-----------|
| chat | gpt-oss-120b | glm-4.5-air | llama-3.3-70b |
| moderator | aurora-alpha | trinity-mini | gpt-oss-120b |
| reasoner | qwen3-coder | trinity-large-preview | gpt-oss-120b |
| compactor | deepseek-r1-0528 | qwen3-coder | glm-4.5-air |

To switch: edit the `model:` line in the agent's `.md` file and restart Iris.

## Model Capabilities Matrix

### Tool Calling Reliability (tested with Iris's 30+ tools)

| Model | Single tool | Chain (3-5) | Chain (5+) | Structured output |
|-------|-----------|------------|-----------|------------------|
| gpt-oss-120b | Excellent | Good | Degrades | Native JSON |
| glm-4.5-air | Excellent | Excellent | Good (thinking mode) | Good |
| aurora-alpha | Good | Untested | Untested | Unknown |
| qwen3-coder | Excellent | Excellent | Excellent | Native |
| deepseek-r1-0528 | Limited | Poor | Poor | Via CoT |
| trinity-large | Good | Good | Good | Good |
| trinity-mini | Good | Acceptable | Poor | Basic |
| llama-3.3-70b | Good | Good | Acceptable | Good |

### Speed Profile (tokens/second, approximate)

| Model | Active params | Architecture | Expected TTFT | Throughput |
|-------|-------------|-------------|--------------|-----------|
| gpt-oss-120b | 5.1B | MoE 117B | <500ms | ~200 tok/s |
| aurora-alpha | Unknown | Cloaked | <300ms | Fast |
| trinity-mini | 3B | MoE 26B | <200ms | Very fast |
| glm-4.5-air | Compact MoE | MoE | <500ms | ~120 tok/s |
| trinity-large | 13B | MoE 400B | <800ms | Moderate |
| qwen3-coder | 35B | MoE 480B | ~2s | ~5 tok/s |
| deepseek-r1-0528 | 37B | MoE 671B | ~1.5s | Moderate |
| llama-3.3-70b | 70B | Dense | ~1s | ~40 tok/s |

### Context Window

| Model | Window | Best for |
|-------|--------|---------|
| qwen3-coder | 262K | Huge vault context + long conversations |
| step-3.5-flash | 256K | Large system prompt injection |
| nemotron-nano | 256K | Lightweight + long context |
| deepseek-r1-0528 | 164K | Deep reasoning on long transcripts |
| gpt-oss-120b | 131K | Standard conversations |
| glm-4.5-air | 131K | Standard with thinking |
| trinity-large | 131K | Agent harness workflows |
| aurora-alpha | 128K | Speed-critical |
| llama-3.3-70b | 128K | Multilingual fallback |

### Multilingual (Romanian / Russian / English)

| Model | EN | RO | RU | Notes |
|-------|----|----|-----|-------|
| gpt-oss-120b | ★★★★★ | ★★★☆☆ | ★★★☆☆ | OpenAI training data skews English |
| glm-4.5-air | ★★★★☆ | ★★★☆☆ | ★★★★☆ | Chinese lab, good multilingual |
| llama-3.3-70b | ★★★★★ | ★★★★☆ | ★★★☆☆ | Explicit multilingual training |
| qwen3-coder | ★★★★★ | ★★★☆☆ | ★★★☆☆ | Code-focused, weaker on RO |
| trinity-large | ★★★★☆ | ★★☆☆☆ | ★★☆☆☆ | English-dominant |

## Privacy Considerations

**All free OpenRouter models log prompts and completions to their providers.**

This means:
- User PII stored via `enrich_profile` is visible to model providers
- System prompts (including vault context injection) are logged
- Governance directives are exposed in transit

Mitigations in place:
- D1 governance directive prevents AI from disclosing internals to users
- Vault data is fragmented (no single prompt contains full user profile)
- Onboarding layer 1 (statistical) runs locally with zero AI cost
- Auto-reply templates bypass AI entirely for common queries

If you add budget, prioritize `deepseek/deepseek-v3.2` ($0.14/M input) — it's the single biggest upgrade for tool calling + privacy (self-hosted option available).

## Monitoring

### Check model performance
```bash
# Via Iris CLI
iris status

# Via tool (from chat)
Use `usage_summary` to see per-model token usage and response times
```

### Signs of model degradation
- Increased "empty response" rate → model may be rate-limited
- Tool calls returning malformed JSON → model struggling with tool schema
- Response times >10s for simple queries → provider congestion
- Vault memories being stored with wrong schema → model confusion

### Recovery steps
1. Check OpenRouter status: https://status.openrouter.ai
2. Switch to fallback model (edit agent `.md` file)
3. If widespread: temporarily increase auto-reply coverage
4. Monitor via `heartbeat_status` for component-level health
