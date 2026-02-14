# Appendix: Free Model Known Limitations

This appendix documents observed limitations of each free OpenRouter model when used with Iris Gateway's 30+ tool ecosystem. Updated February 2026.

## gpt-oss-120b:free (Primary Chat)

**Strengths**: Fastest inference for its intelligence class. Native function calling with configurable reasoning depth. Structured JSON output. Apache 2.0 license.

**Limitations**:
- Reasoning depth at "low" setting can miss nuance in complex vault queries. Use "medium" for chat (default), "high" only when explicitly needed.
- Romanian language output occasionally mixes with Italian cognates. The onboarding layer's language detection corrects this over time via `enrich_profile`.
- When context exceeds ~80K tokens, tool call accuracy degrades. The session compaction hook should fire before this threshold.
- Free tier rate limits are undocumented. Under heavy load (50+ concurrent users), expect 429 responses. The auto-reply engine absorbs peak traffic.

## aurora-alpha (Moderator)

**Strengths**: Extremely fast responses. Free. Good at binary classification tasks.

**Limitations**:
- Cloaked model — identity and training data unknown. Do not use for sensitive decisions beyond content moderation.
- Released 2026-02-09, very new — production track record is zero. Monitor closely.
- All prompts and completions are logged by the provider. Do not pass raw user PII through moderation — strip to sender ID + message text only.
- No guaranteed SLA or availability commitment. Have trinity-mini as instant fallback.
- Tool calling is supported per OpenRouter metadata but real-world reliability with Iris's complex tool schemas is untested.

## qwen3-coder:free (Reasoner)

**Strengths**: Purpose-built for agentic coding with function calling. 262K context window. 480B total parameters. Handles long multi-step tool chains (10+ calls) reliably.

**Limitations**:
- Slow. ~5 tok/s on cluster inference. Not suitable for real-time chat — only use as a subagent for background tasks.
- Free tier routing may hit different quantization backends. Response quality can vary between requests.
- Chinese-lab model — weaker on Romanian than English. For RO-heavy users, consider falling back to llama-3.3-70b for the reasoner role.
- Pricing on Alibaba endpoints changes above 128K input tokens. The free tier may have a lower effective context ceiling.

## deepseek-r1-0528:free (Compactor)

**Strengths**: Best pure reasoning model in the free tier. 671B parameters. Deep chain-of-thought that excels at fact extraction from long conversations.

**Limitations**:
- **Not designed for tool calling.** R1 is a reasoning model. It can technically produce tool call JSON but reliability is poor. Only use for text analysis tasks (session compaction, summarization).
- Reasoning tokens consume output budget. A simple fact extraction may produce 2000+ reasoning tokens before the actual answer. Set max_tokens generously.
- Response times are unpredictable — sometimes 2s, sometimes 30s depending on reasoning depth.
- The `<think>` block in responses may leak into tool server if not properly stripped. The OpenCode plugin should handle this, but verify.

## trinity-large-preview:free (Alt Primary)

**Strengths**: Explicitly trained on OpenCode, Cline, and Kilo Code agent harnesses. Handles complex toolchains and constraint-filled prompts. 400B/13B MoE. 131K context.

**Limitations**:
- "Preview" status — Arcee may change or remove this model. Not guaranteed stable.
- 8-bit quantization on the preview API may reduce quality vs full-precision weights.
- Weaker on non-English languages compared to gpt-oss-120b or llama-3.3.
- Free endpoint is the same as the current default in the existing config. If you were already experiencing issues with this model, the new config moves it to alt-primary fallback role.

## trinity-mini:free (Proactive/Light)

**Strengths**: Ultra-lightweight (3B active). Fast. Good enough for simple tool calls like `proactive_quota`, `heartbeat_status`, and `enrich_profile`.

**Limitations**:
- 3B active parameters means limited reasoning. Do not use for complex multi-tool chains.
- May struggle with long system prompts (131K context is theoretical — real performance degrades earlier).
- Function calling works for simple schemas but may produce malformed arguments for tools with many parameters.
- Best for single-shot tool calls only.

## glm-4.5-air:free (Cron/Fallback)

**Strengths**: Purpose-built for agent-centric applications. Hybrid thinking/non-thinking modes. Strong multilingual support.

**Limitations**:
- "Thinking mode" reasoning tokens count toward output. Budget max_tokens accordingly.
- Z.ai's free tier infrastructure can be slow under heavy load (~12 tok/s reported on OpenRouter).
- The thinking/non-thinking toggle requires the `reasoning.enabled` boolean in the API call. Verify that OpenCode's plugin passes this parameter correctly.
- Korean optimization in the model family may not benefit RO/RU/EN use case.

## llama-3.3-70b-instruct:free (Battle-tested Fallback)

**Strengths**: Meta's most reliable open model. Explicit multilingual training (8 languages). Dense architecture means consistent quality (no MoE routing variance).

**Limitations**:
- Dense 70B = all parameters active every pass = slowest model in the lineup (~40 tok/s).
- 128K context is the smallest among the options (tied with aurora-alpha).
- No reasoning mode toggle — always one mode. For tasks that need deep reasoning, use deepseek-r1.
- Free tier availability fluctuates. Meta has historically maintained free access but with rate limits.

## Cross-Cutting Concerns

### All free models
- **Logging**: All prompts and completions are logged by providers. Accept this or add budget.
- **Rate limits**: Undocumented per-model. Build fallback chains.
- **No SLA**: Free means no uptime guarantees. Monitor via heartbeat.
- **Quantization variance**: Free endpoints may serve different quantization levels at different times.

### Iris-specific integration notes
- The `experimental.chat.system.transform` hook injects vault context, profile data, memories, governance directives, and skill suggestions into the system prompt. This can reach 10-20K tokens before the user even speaks. Models with smaller effective context windows may struggle.
- Tool schemas for Iris's 30+ tools are registered via the plugin manifest. Some models handle large tool arrays better than others. If a model struggles, reduce the tool set in its agent frontmatter.
- Streaming config (`breakOn`, `idleMs`, `minChars`) interacts with model speed. Faster models (aurora-alpha, trinity-mini) may need lower `idleMs` to avoid stuttering. Slower models (qwen3-coder) need higher values.
