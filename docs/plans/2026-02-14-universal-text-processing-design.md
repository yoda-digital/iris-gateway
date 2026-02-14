# Universal Text Processing — Design

## Problem

The intelligence layer has hardcoded language assumptions in three files:

1. **`src/intelligence/outcomes/categorizer.ts`** — ~80 lines of EN/RO/RU keyword dictionaries that map intent text to categories. Adding a language = adding keywords to every category. Combinatorial explosion.

2. **`src/intelligence/arcs/detector.ts`** — `/[^a-z0-9\s-]/g` regex destroys ALL non-Latin characters (Cyrillic, Arabic, CJK, diacritics). English-only stop words. Fundamentally broken for non-ASCII scripts.

3. **`src/intelligence/triggers/rules.ts`** — Multilingual regex for "tomorrow" (7 languages) and time prepositions (6 languages). Finite list, never universal.

## Core Insight

**Stop trying to understand language. Delegate semantics to the AI, process structure.**

The AI already knows what things mean. When it calls `proactive_intent({ what: "Check homework" })`, it wrote that text. Reverse-engineering meaning from it with keyword dictionaries is solving a problem that doesn't exist.

## Design

### 1. Categorizer: AI Passes Category Directly

**Current**: AI calls `proactive_intent({ what: "..." })` → categorizer guesses category from keywords

**New**: AI calls `proactive_intent({ what: "...", category: "task" })` → stored directly

- Add optional `category` param to `proactive_intent` tool (plugin + tool-server endpoint)
- `categorizeIntent()` becomes: if category provided, use it; else "general"
- Delete all keyword lists — the AI is the categorizer
- Valid categories: `task | work | health | hobby | social | reminder | general`

### 2. Arc Detector: Unicode-Aware Tokenization

**Current**: ASCII regex + English stop words

**New**: Unicode-aware regex + length filter (no stop words at all)

- Replace `/[^a-z0-9\s-]/g` with `/[^\p{L}\p{N}\s-]/gu` — preserves ALL Unicode letters
- Delete STOP_WORDS set entirely
- Filter tokens by length (>=3 chars) only — works for every script
- `findArcByKeywords()` already does `.toLowerCase()` which is Unicode-safe in JS

Arcs only need within-user matching. A Russian speaker's memories are in Russian — we match Russian tokens against Russian arc titles. No cross-script matching needed.

### 3. Triggers: Structural Pattern Detection

**Current**: Language-specific regex for "tomorrow" and time prepositions

**New**:

- **dateMention**: Keep as-is — already universal (numeric pattern `\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}`)
- **timeMention**: Replace preposition regex with direct numeric match: `\b(\d{1,2}):(\d{2})\b` plus `\b(\d{1,2})\s*(am|pm)\b/i`. Detect the time itself, don't need the preposition.
- **tomorrowIntent**: Split into two layers:
  - Layer 1: Compact "tomorrow" word list covering ~95% of global population by native speakers (~20 words, not language-specific regex but a simple Set lookup)
  - Layer 2: Drop the "will/voi/буду" requirement entirely — detecting "tomorrow" + non-question sentence structure is sufficient for a 0.65 confidence intent
- **dormancyRecovery**: Keep as-is — signal-based, no text analysis
- **engagementDrop**: Keep as-is — signal-based, no text analysis

### 4. Tomorrow Word Coverage

One pragmatic concession: "tomorrow" is a single word per language. A Set of ~20 covers 95%+ of humanity by native speakers:

```
tomorrow, maine, mîine, завтра, morgen, demain, mañana, domani,
amanhã, yarın, 明天, 明日, 내일, कल, غدا, آینده, พรุ่งนี้,
ngày mai, holnap, huomenna, αύριο, jutro
```

This is NOT a dictionary or keyword list — it's a single-concept lookup table that doesn't grow with features. No new words needed to support new categories, arcs, or intents.

## What Gets Deleted

| File | Removed | Replaced With |
|------|---------|---------------|
| `categorizer.ts` | ~80 lines of CATEGORY_KEYWORDS + scoring loop | ~15-line passthrough (validate category or default to "general") |
| `detector.ts` extractKeywords() | ASCII regex + 15-line STOP_WORDS | 3-line Unicode regex + length filter |
| `rules.ts` tomorrowIntent | 10-line dual regex with will/voi/буду requirement | Set lookup for "tomorrow" + non-question check |
| `rules.ts` timeMention | 5-line preposition regex | Direct numeric time match |

Net: ~130 lines of language-specific code deleted, ~40 lines of universal code added.

## Files Changed

**Modified (5):**
- `src/intelligence/outcomes/categorizer.ts` — rewrite to passthrough
- `src/intelligence/arcs/detector.ts` — Unicode regex, remove stop words
- `src/intelligence/triggers/rules.ts` — structural patterns
- `.opencode/plugin/iris.ts` — add `category` to proactive_intent tool
- `src/bridge/tool-server.ts` — pass category through /proactive/intent endpoint

**Modified tests (up to 3):**
- Tests for categorizer, arc detector, and trigger rules

## Verification

- `npx tsc --noEmit` — clean build
- `npx vitest run` — all tests pass
- Manual verification: Cyrillic text through arc detector produces valid keywords
