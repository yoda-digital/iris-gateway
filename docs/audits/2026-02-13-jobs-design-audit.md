# Steve Jobs Design Thinking Audit -- Iris Architecture

**Date**: 2026-02-13
**Subject**: HTTP bridge pattern vs OpenCode plugin SDK integration
**Status**: 13/13 Questions Answered

---

## Q1: SIMPLIFICATION -- "How can I make this simpler?"

The HTTP bridge (`tool-server.ts` at 197 LOC) adds an unnecessary indirection layer. The `.opencode/tools/*.ts` files are just HTTP fetch wrappers. This can be consolidated by moving all tools into a single `.opencode/plugin/iris.ts` plugin file. The plugin still calls Iris's HTTP server for IPC (necessary since OpenCode runs as a child process), but eliminates 4 separate tool stub files and consolidates the integration point from 5 files to 1.

**Action**: Create `.opencode/plugin/iris.ts`, delete `.opencode/tools/*.ts`.

---

## Q2: ZERO-BASED THINKING -- "What would this look like if I started from zero?"

If building from scratch knowing OpenCode's plugin SDK: Iris would be an OpenCode plugin first, gateway process second. The plugin owns tool registration, hooks, and session context. The gateway manages channel adapters. No scattered tool stub files. The `.opencode/` directory contains one plugin, not awkward HTTP-fetching stubs.

---

## Q3: CORE FUNCTION -- "What's the ONE thing this absolutely must do perfectly?"

Route messages between messaging platforms and an AI model **with context**. Message arrives from Telegram/WhatsApp/Discord/Slack, reaches the AI with full user context (identity, history, permissions), and the response returns to the right channel. Everything else serves this loop.

---

## Q4: BEGINNER'S MIND -- "How would I design this for someone who's never seen it before?"

A newcomer is confused by the dual-server architecture (OpenCode :4096, ToolServer :19877) and circular HTTP flow. The plugin model is immediately clear: "Iris is an OpenCode plugin that connects messaging channels to the AI." One concept, one integration point.

---

## Q5: ELEGANCE -- "What would the most elegant solution be?"

Iris IS an OpenCode plugin. The plugin exports tools, hooks, and MCP config. The gateway process starts OpenCode with the plugin loaded, then starts channel adapters. Everything flows through OpenCode's event system. Developer mental model drops from 6 concepts to 3.

---

## Q6: COMPLEXITY AUDIT -- "Where am I adding complexity that users don't value?"

| Source | LOC | User-Visible? | Verdict |
|--------|-----|--------------|---------|
| tool-server.ts HTTP callbacks | ~197 | No | Evolve (add vault/governance endpoints) |
| .opencode/tools/*.ts wrappers (x4) | ~100 | No | Delete (move to plugin) |
| Dual-port architecture | N/A | No | Keep (architecturally necessary) |
| SSE subscription separate from tools | ~50 | No | Unify in plugin event hook |

---

## Q7: MAGIC EXPERIENCE -- "What would this be like if it just worked magically?"

Install Iris, run `iris gateway run`. AI appears on all platforms. It knows your name across sessions. It enforces safety without configuration. It searches the web, manages notes, controls devices. Adding capability = adding an MCP server or skill file. No port configuration, no tool stubs to maintain.

---

## Q8: INSANELY GREAT -- "How would I make this insanely great?"

1. **Cross-session memory**: AI remembers you like a real assistant
2. **Proactive governance**: Self-monitors via hooks, explains refusals
3. **MCP ecosystem**: One-line capability additions
4. **Context injection**: Every message enriched with profile + memories
5. **Insight extraction**: Learns from every conversation

---

## Q9: RESTRAINT CHECK -- "What am I including because I can, not because I should?"

Don't build: full knowledge graph (start with SQLite FTS5), all 15+ tools at once (start with 9), all 14 hooks (start with 6), full D1-D4 governance framework (start with configurable rules), MCP servers beyond immediately useful (start with 2-3).

---

## Q10: ACCESSIBLE SIMPLICITY -- "How can I make the complex appear simple?"

Metaphor: "Iris is a brain (OpenCode plugin) with arms (channel adapters)." The brain thinks, remembers, follows rules, and uses skills. The arms reach into platforms. Adding a channel = teaching a new arm. Adding a capability = giving a new skill.

---

## Q11: PERSONAL USE CASE -- "What would this look like if I designed it for myself?"

Memory that works. Web search built in. Safety guardrails in group chats. Extensible via file drops. Zero maintenance after setup.

---

## Q12: QUALITY BLIND SPOTS -- "Where am I compromising?"

| Blind Spot | Impact | Priority |
|-----------|--------|----------|
| No memory | Users re-introduce themselves every time | Critical |
| No governance | Prompt injection vulnerability | High |
| No context enrichment | AI sees raw text without user context | High |
| No audit trail | Can't debug or improve | Medium |
| Rigid extensibility | Adding tools requires TS editing | Medium |

---

## Q13: INEVITABLE FLOW -- "How can I make this feel inevitable?"

```
User sends message -> Adapter normalizes -> Hook enriches with context
-> AI processes with awareness -> Hook validates response
-> Tool calls adapter directly -> Response delivered
```

Each step flows into the next through OpenCode's event system. No HTTP detours. Water flowing downhill.

---

## COMPLETION: 13/13

## TOP 3 IMMEDIATE ACTIONS

1. Create `.opencode/plugin/iris.ts` — consolidate tools + add hooks
2. Add SQLite vault — cross-session memory with FTS5
3. Add 2 MCP servers — web search + sequential thinking

## THE ONE GREAT IDEA

> **Iris should BE an OpenCode plugin, not a bridge TO OpenCode.** This single shift cascades into fixing every gap: memory, governance, audit, context injection, extensibility.
