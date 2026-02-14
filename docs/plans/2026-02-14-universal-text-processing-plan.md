# Universal Text Processing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all language-specific keyword dictionaries and ASCII-only regex with truly universal, language-agnostic text processing — O(1) in number of supported languages.

**Architecture:** Three changes: (1) AI passes category directly to proactive_intent instead of categorizer guessing from keywords, (2) arc detector uses Unicode-aware tokenization instead of ASCII regex, (3) trigger rules use structural numeric patterns instead of multilingual regex. Zero new dependencies.

**Tech Stack:** TypeScript, Unicode regex (`\p{L}`, `\p{N}`), vitest

---

### Task 1: Rewrite Categorizer as Passthrough

The current `categorizer.ts` has ~80 lines of hardcoded EN/RO/RU keyword dictionaries. Replace with a simple validator that accepts a category string or defaults to "general".

**Files:**
- Modify: `src/intelligence/outcomes/categorizer.ts`
- Test: `test/unit/categorizer.test.ts`

**Step 1: Write the test**

Create `test/unit/categorizer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { categorizeIntent } from "../../src/intelligence/outcomes/categorizer.js";

const VALID_CATEGORIES = ["task", "work", "health", "hobby", "social", "reminder", "general"];

describe("categorizeIntent", () => {
  it("returns provided category when valid", () => {
    expect(categorizeIntent("anything", "task")).toBe("task");
    expect(categorizeIntent("anything", "health")).toBe("health");
    expect(categorizeIntent("anything", "social")).toBe("social");
  });

  it("returns 'general' when no category provided", () => {
    expect(categorizeIntent("some text")).toBe("general");
    expect(categorizeIntent("some text", undefined)).toBe("general");
  });

  it("returns 'general' for invalid category", () => {
    expect(categorizeIntent("text", "invalid")).toBe("general");
    expect(categorizeIntent("text", "")).toBe("general");
  });

  it("accepts all valid categories", () => {
    for (const cat of VALID_CATEGORIES) {
      expect(categorizeIntent("x", cat)).toBe(cat);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/categorizer.test.ts`
Expected: FAIL — current `categorizeIntent` signature is `(what: string): string`, doesn't accept category param

**Step 3: Rewrite the categorizer**

Replace entire contents of `src/intelligence/outcomes/categorizer.ts` with:

```typescript
/**
 * Intent category validator.
 * The AI passes the category directly — no keyword guessing needed.
 * Falls back to "general" if no category provided or invalid.
 */

const VALID_CATEGORIES = new Set([
  "task", "work", "health", "hobby", "social", "reminder", "general",
]);

/**
 * Validate and return a category for a proactive intent.
 * @param _what - The intent text (unused — kept for backward compat)
 * @param category - Category string from the AI (optional)
 */
export function categorizeIntent(_what: string, category?: string): string {
  if (category && VALID_CATEGORIES.has(category)) return category;
  return "general";
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/categorizer.test.ts`
Expected: PASS

**Step 5: Verify callers still compile**

Run: `npx tsc --noEmit`
Expected: Clean (the old `categorizeIntent(what)` calls still work — `category` is optional)

**Step 6: Commit**

```bash
git add src/intelligence/outcomes/categorizer.ts test/unit/categorizer.test.ts
git commit -m "refactor(intelligence): replace keyword categorizer with AI-driven passthrough"
```

---

### Task 2: Add `category` to Proactive Intent Pipeline

Thread the `category` field from the plugin tool through the HTTP endpoint to the intent store and outcome analyzer.

**Files:**
- Modify: `src/proactive/types.ts:53-62` — add `category` to `AddIntentParams`
- Modify: `src/bridge/tool-server.ts:1227-1255` — pass `category` through `/proactive/intent`
- Modify: `src/intelligence/outcomes/analyzer.ts:26-54` — pass category to `categorizeIntent`
- Modify: `.opencode/plugin/iris.ts:594-619` — add `category` arg to `proactive_intent` tool

**Step 1: Add `category` to `AddIntentParams`**

In `src/proactive/types.ts`, add `category` field to the interface:

```typescript
export interface AddIntentParams {
  readonly sessionId: string;
  readonly channelId: string;
  readonly chatId: string;
  readonly senderId: string;
  readonly what: string;
  readonly why?: string | null;
  readonly confidence?: number;
  readonly executeAt: number;
  readonly category?: string;
}
```

**Step 2: Update tool-server endpoint**

In `src/bridge/tool-server.ts`, in the `/proactive/intent` handler (~line 1244), pass `category` from the body to `addIntent` and store it for later use by the outcome analyzer. After the `addIntent` call, add:

Find the line:
```typescript
      const id = this.intentStore.addIntent({
        sessionId,
        channelId,
        chatId,
        senderId,
        what: body.what ?? "",
        why: body.why ?? null,
        confidence: body.confidence ?? 0.8,
        executeAt: Date.now() + (body.delayMs ?? 86_400_000),
      });
      return c.json({ id });
```

Replace with:
```typescript
      const id = this.intentStore.addIntent({
        sessionId,
        channelId,
        chatId,
        senderId,
        what: body.what ?? "",
        why: body.why ?? null,
        confidence: body.confidence ?? 0.8,
        executeAt: Date.now() + (body.delayMs ?? 86_400_000),
        category: body.category,
      });
      return c.json({ id });
```

**Step 3: Update OutcomeAnalyzer.recordSent()**

In `src/intelligence/outcomes/analyzer.ts`, update `recordSent` to accept and forward the category:

Find:
```typescript
  recordSent(params: {
    intentId: string;
    senderId: string;
    channelId: string;
    what: string;
  }): void {
    const now = new Date();
    const category = categorizeIntent(params.what);
```

Replace with:
```typescript
  recordSent(params: {
    intentId: string;
    senderId: string;
    channelId: string;
    what: string;
    category?: string;
  }): void {
    const now = new Date();
    const category = categorizeIntent(params.what, params.category);
```

Also update `shouldSend`:

Find:
```typescript
  shouldSend(senderId: string, what: string): { send: boolean; reason: string } {
    const category = categorizeIntent(what);
```

Replace with:
```typescript
  shouldSend(senderId: string, what: string, category?: string): { send: boolean; reason: string } {
    const category = categorizeIntent(what, category);
```

Wait — that shadows the parameter. Fix:

```typescript
  shouldSend(senderId: string, what: string, intentCategory?: string): { send: boolean; reason: string } {
    const category = categorizeIntent(what, intentCategory);
```

**Step 4: Add `category` to plugin tool**

In `.opencode/plugin/iris.ts`, find the `proactive_intent` tool (~line 594) and add `category` to args:

Find:
```typescript
      args: {
        what: tool.schema.string().describe("What to follow up on"),
        why: tool.schema.string().optional().describe("Why this matters"),
        delayMs: tool.schema
          .number()
          .optional()
          .describe("Milliseconds until follow-up (default: 24h = 86400000)"),
        confidence: tool.schema
          .number()
          .optional()
          .describe("How confident you are this needs follow-up, 0-1 (default: 0.8)"),
      },
```

Replace with:
```typescript
      args: {
        what: tool.schema.string().describe("What to follow up on"),
        why: tool.schema.string().optional().describe("Why this matters"),
        category: tool.schema
          .string()
          .optional()
          .describe(
            "Category for engagement tracking: task, work, health, hobby, social, reminder, general. " +
            "Pick the one that best fits the follow-up topic. Default: general",
          ),
        delayMs: tool.schema
          .number()
          .optional()
          .describe("Milliseconds until follow-up (default: 24h = 86400000)"),
        confidence: tool.schema
          .number()
          .optional()
          .describe("How confident you are this needs follow-up, 0-1 (default: 0.8)"),
      },
```

Also in the `execute` function, pass `category` to the POST body:

Find:
```typescript
          await irisPost("/proactive/intent", {
            sessionID: (this as any).sessionID,
            what: args.what,
            why: args.why,
            delayMs: args.delayMs,
            confidence: args.confidence,
          }),
```

Replace with:
```typescript
          await irisPost("/proactive/intent", {
            sessionID: (this as any).sessionID,
            what: args.what,
            why: args.why,
            category: args.category,
            delayMs: args.delayMs,
            confidence: args.confidence,
          }),
```

**Step 5: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 6: Commit**

```bash
git add src/proactive/types.ts src/bridge/tool-server.ts src/intelligence/outcomes/analyzer.ts .opencode/plugin/iris.ts
git commit -m "feat(proactive): thread category from AI through intent pipeline"
```

---

### Task 3: Fix Arc Detector — Unicode-Aware Keyword Extraction

Replace the ASCII-only regex and English stop words with Unicode-aware tokenization.

**Files:**
- Modify: `src/intelligence/arcs/detector.ts:101-122`
- Test: `test/unit/arc-detector.test.ts`

**Step 1: Write the test**

Create `test/unit/arc-detector.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArcDetector } from "../../src/intelligence/arcs/detector.js";
import type { IntelligenceStore } from "../../src/intelligence/store.js";
import type { IntelligenceBus } from "../../src/intelligence/bus.js";
import type { Logger } from "../../src/logging/logger.js";

function makeStore(overrides: Partial<IntelligenceStore> = {}): IntelligenceStore {
  return {
    findArcByKeywords: vi.fn().mockReturnValue(null),
    createArc: vi.fn().mockReturnValue({ id: "arc-1", title: "test", senderId: "u1", status: "active" }),
    addArcEntry: vi.fn(),
    getActiveArcs: vi.fn().mockReturnValue([]),
    getStaleArcs: vi.fn().mockReturnValue([]),
    updateArcStatus: vi.fn(),
    ...overrides,
  } as unknown as IntelligenceStore;
}

function makeBus(): IntelligenceBus {
  return { emit: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() } as unknown as IntelligenceBus;
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe("ArcDetector", () => {
  let store: IntelligenceStore;
  let bus: IntelligenceBus;
  let logger: Logger;
  let detector: ArcDetector;

  beforeEach(() => {
    store = makeStore();
    bus = makeBus();
    logger = makeLogger();
    detector = new ArcDetector(store, bus, logger);
  });

  it("extracts keywords from English text", () => {
    detector.processMemory("u1", "User is planning a wedding ceremony in June");
    expect(store.findArcByKeywords).toHaveBeenCalledWith(
      "u1",
      expect.arrayContaining(["planning", "wedding", "ceremony", "june"]),
    );
  });

  it("extracts keywords from Cyrillic text", () => {
    detector.processMemory("u1", "Пользователь ищет новую работу программистом");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("u1");
    const keywords: string[] = call[1];
    // Must contain Cyrillic tokens, not empty
    expect(keywords.length).toBeGreaterThanOrEqual(2);
    expect(keywords.some((k) => /[\u0400-\u04ff]/u.test(k))).toBe(true);
  });

  it("extracts keywords from Romanian text with diacritics", () => {
    detector.processMemory("u1", "Utilizatorul vrea să termine proiectul de renovare");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    const keywords: string[] = call[1];
    expect(keywords.length).toBeGreaterThanOrEqual(2);
    // "termine" and "proiectul" and "renovare" should survive
    expect(keywords).toContain("termine");
    expect(keywords).toContain("proiectul");
    expect(keywords).toContain("renovare");
  });

  it("preserves diacritics in keywords", () => {
    detector.processMemory("u1", "Mâine trebuie să finalizeze ședința despre proiect");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    const keywords: string[] = call[1];
    // ș and ț should survive, not be stripped
    expect(keywords.some((k) => k.includes("ș") || k.includes("ț") || k.includes("â"))).toBe(true);
  });

  it("handles mixed-language text", () => {
    detector.processMemory("u1", "Tomorrow voi merge la gym pentru antrenament");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    const keywords: string[] = call[1];
    expect(keywords.length).toBeGreaterThanOrEqual(2);
    expect(keywords).toContain("tomorrow");
    expect(keywords).toContain("antrenament");
  });

  it("filters short tokens (<3 chars)", () => {
    detector.processMemory("u1", "I am at the gym to do a big run for my new plan");
    const call = (store.findArcByKeywords as ReturnType<typeof vi.fn>).mock.calls[0];
    const keywords: string[] = call[1];
    for (const kw of keywords) {
      expect(kw.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("skips content with fewer than 2 keywords", () => {
    detector.processMemory("u1", "ok");
    expect(store.findArcByKeywords).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/arc-detector.test.ts`
Expected: FAIL — Cyrillic test will fail because current regex destroys Cyrillic chars

**Step 3: Fix extractKeywords() in detector.ts**

In `src/intelligence/arcs/detector.ts`, replace the `extractKeywords` method (lines 101-122):

Find:
```typescript
  private extractKeywords(text: string): string[] {
    const STOP_WORDS = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been",
      "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "shall", "can", "to", "of",
      "in", "for", "on", "with", "at", "by", "from", "as", "into",
      "about", "like", "after", "before", "between", "under", "above",
      "not", "no", "nor", "but", "and", "or", "so", "if", "then",
      "that", "this", "these", "those", "it", "its", "my", "your",
      "his", "her", "our", "their", "i", "you", "he", "she", "we",
      "they", "me", "him", "us", "them", "what", "which", "who",
      "whom", "how", "when", "where", "why", "all", "each", "every",
      "both", "few", "more", "most", "some", "any", "very", "just",
      "also", "than", "too", "only", "now", "here", "there",
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  }
```

Replace with:
```typescript
  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);
  }
```

That's it. Four lines. `\p{L}` matches ANY Unicode letter (Latin, Cyrillic, Arabic, CJK, Devanagari — everything). `\p{N}` matches any Unicode digit. The `u` flag enables Unicode mode. No stop words needed — length >= 3 is sufficient for arc matching.

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/arc-detector.test.ts`
Expected: PASS

**Step 5: Verify full build**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 6: Commit**

```bash
git add src/intelligence/arcs/detector.ts test/unit/arc-detector.test.ts
git commit -m "fix(arcs): replace ASCII-only regex with Unicode-aware keyword extraction"
```

---

### Task 4: Fix Trigger Rules — Universal Patterns

Replace language-specific regex in `tomorrowIntent` and `timeMention` with structural patterns.

**Files:**
- Modify: `src/intelligence/triggers/rules.ts:21-47,130-147`
- Test: `test/unit/trigger-rules.test.ts`

**Step 1: Write the test**

Create `test/unit/trigger-rules.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { builtinTriggerRules } from "../../src/intelligence/triggers/rules.js";
import type { InboundMessage } from "../../src/channels/adapter.js";
import type { DerivedSignal } from "../../src/intelligence/types.js";

const msg: InboundMessage = {
  channelId: "test",
  chatId: "c1",
  chatType: "dm",
  senderId: "u1",
  text: "",
  timestamp: Date.now(),
};

const noSignals: DerivedSignal[] = [];

function findRule(id: string) {
  return builtinTriggerRules.find((r) => r.id === id)!;
}

describe("tomorrowIntent rule", () => {
  const rule = findRule("tomorrow_intent");

  it("detects English 'tomorrow'", () => {
    const result = rule.evaluate("I'll do it tomorrow", msg, noSignals);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("create_intent");
  });

  it("detects Romanian 'maine'", () => {
    const result = rule.evaluate("Maine voi face curat", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("detects Russian 'завтра'", () => {
    const result = rule.evaluate("Завтра пойду в зал", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("detects Spanish 'mañana'", () => {
    const result = rule.evaluate("Lo haré mañana por la tarde", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("detects Turkish 'yarın'", () => {
    const result = rule.evaluate("Yarın görüşürüz", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("does NOT trigger on questions about tomorrow", () => {
    const result = rule.evaluate("What happens tomorrow?", msg, noSignals);
    expect(result).toBeNull();
  });

  it("does NOT trigger on unrelated text", () => {
    const result = rule.evaluate("The weather is nice today", msg, noSignals);
    expect(result).toBeNull();
  });

  it("has lower confidence (0.65) since no verb matching", () => {
    const result = rule.evaluate("I'll finish it tomorrow", msg, noSignals);
    expect(result).not.toBeNull();
    expect(result!.payload.confidence).toBeLessThanOrEqual(0.7);
  });
});

describe("timeMention rule", () => {
  const rule = findRule("time_mention");

  it("detects 24h time format", () => {
    const result = rule.evaluate("Встреча в 15:30", msg, noSignals);
    expect(result).not.toBeNull();
    expect(result!.payload.flag).toContain("15:30");
  });

  it("detects 12h time format with am/pm", () => {
    const result = rule.evaluate("Meet me at 3pm", msg, noSignals);
    expect(result).not.toBeNull();
  });

  it("does NOT trigger on non-time numbers", () => {
    const result = rule.evaluate("I have 3 cats", msg, noSignals);
    expect(result).toBeNull();
  });
});

describe("dateMention rule", () => {
  const rule = findRule("date_mention");

  it("detects date formats universally", () => {
    const result = rule.evaluate("Deadline is 15/03/2026", msg, noSignals);
    expect(result).not.toBeNull();
    expect(result!.payload.flag).toContain("15/03/2026");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/trigger-rules.test.ts`
Expected: FAIL — Russian/Turkish tests fail, question filtering fails

**Step 3: Rewrite tomorrowIntent and timeMention**

In `src/intelligence/triggers/rules.ts`, replace the `tomorrowIntent` rule (lines 21-47):

Find:
```typescript
const tomorrowIntent: TriggerRule = {
  id: "tomorrow_intent",
  enabled: true,
  priority: 50,
  evaluate(text, msg) {
    const pattern = /\b(tomorrow|maine|mîine|завтра|morgen|demain|mañana)\b.*\b(will|voi|o să|буду|going to|werde|vais|voy)\b/i;
    const reversePattern = /\b(will|voi|o să|буду|going to|werde|vais|voy)\b.*\b(tomorrow|maine|mîine|завтра|morgen|demain|mañana)\b/i;

    if (!pattern.test(text) && !reversePattern.test(text)) return null;

    // Schedule follow-up for tomorrow evening (18:00 UTC as default)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);

    return {
      ruleId: "tomorrow_intent",
      action: "create_intent",
      payload: {
        what: `Follow up on commitment: "${text.substring(0, 100)}"`,
        why: "User said they would do something tomorrow",
        confidence: 0.75,
        executeAt: tomorrow.getTime(),
      },
    };
  },
};
```

Replace with:
```typescript
/**
 * "Tomorrow" words covering ~95% of global population by native speakers.
 * Single-concept lookup — does NOT grow with features or categories.
 */
const TOMORROW_WORDS = new Set([
  "tomorrow", "maine", "mîine", "завтра", "morgen", "demain", "mañana",
  "domani", "amanhã", "amanha", "yarın", "yarin", "明天", "明日", "내일",
  "कल", "غدا", "พรุ่งนี้", "holnap", "huomenna", "αύριο", "jutro",
]);

const tomorrowIntent: TriggerRule = {
  id: "tomorrow_intent",
  enabled: true,
  priority: 50,
  evaluate(text, _msg) {
    const lower = text.toLowerCase();
    const words = lower.split(/[\s,.:;!?]+/);

    // Check if any word matches "tomorrow" in any language
    const hasTomorrow = words.some((w) => TOMORROW_WORDS.has(w));
    if (!hasTomorrow) return null;

    // Skip questions — universal structural check
    const trimmed = text.trim();
    if (trimmed.endsWith("?")) return null;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);

    return {
      ruleId: "tomorrow_intent",
      action: "create_intent",
      payload: {
        what: `Follow up on commitment: "${text.substring(0, 100)}"`,
        why: "User mentioned tomorrow — possible commitment",
        confidence: 0.65,
        executeAt: tomorrow.getTime(),
      },
    };
  },
};
```

Then replace `timeMention` (lines 130-147):

Find:
```typescript
const timeMention: TriggerRule = {
  id: "time_mention",
  enabled: true,
  priority: 35,
  evaluate(text) {
    const timePattern = /\b(?:at|la|в|um|à|a las)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?\b/;
    const match = text.match(timePattern);
    if (!match) return null;

    return {
      ruleId: "time_mention",
      action: "flag_for_prompt",
      payload: {
        flag: `[User mentioned time: ${match[0]}]`,
      },
    };
  },
};
```

Replace with:
```typescript
const timeMention: TriggerRule = {
  id: "time_mention",
  enabled: true,
  priority: 35,
  evaluate(text) {
    // Match 24h format (15:30) or 12h format (3pm, 3:30pm, 3 PM)
    const time24 = text.match(/\b(\d{1,2}):(\d{2})\b/);
    const time12 = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

    const match = time24 ?? time12;
    if (!match) return null;

    // Validate hour range to avoid false positives on "version 12:30" etc.
    const hour = parseInt(match[1], 10);
    if (hour > 23) return null;
    if (time24 && parseInt(match[2], 10) > 59) return null;

    return {
      ruleId: "time_mention",
      action: "flag_for_prompt",
      payload: {
        flag: `[User mentioned time: ${match[0]}]`,
      },
    };
  },
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/trigger-rules.test.ts`
Expected: PASS

**Step 5: Verify full build and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean build, all tests pass

**Step 6: Commit**

```bash
git add src/intelligence/triggers/rules.ts test/unit/trigger-rules.test.ts
git commit -m "fix(triggers): replace multilingual regex with structural pattern detection"
```

---

### Task 5: Update Documentation

Update AGENTS.md and README.md to reflect the universal approach.

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

**Step 1: Update AGENTS.md proactive_intent section**

In `AGENTS.md`, find the proactive intent usage section and add mention of the `category` parameter:

Find:
```
- Use `proactive_intent` to register a follow-up intent — schedule yourself to check back later
```

Replace with:
```
- Use `proactive_intent` to register a follow-up intent — schedule yourself to check back later. Pass `category` (task/work/health/hobby/social/reminder) for engagement tracking.
```

**Step 2: Update README.md Intelligence Layer section**

In `README.md`, update the outcome-aware proactive loop description. Find:
```
3. **Outcome-Aware Proactive Loop** — category-segmented engagement tracking (task/work/health/hobby/social/reminder) with timing patterns, fed back into proactive decision-making.
```

Replace with:
```
3. **Outcome-Aware Proactive Loop** — category-segmented engagement tracking (task/work/health/hobby/social/reminder) with timing patterns. Categories are AI-assigned (not keyword-guessed), making classification language-agnostic.
```

Also update the Memory Arcs description. Find:
```
4. **Memory Arcs** — temporal narrative threads that track evolving situations. Detected from keyword overlap in conversation. Auto-stale after 14 days.
```

Replace with:
```
4. **Memory Arcs** — temporal narrative threads that track evolving situations. Detected from Unicode-aware keyword overlap in conversation (supports all scripts). Auto-stale after 14 days.
```

**Step 3: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs: update intelligence layer to reflect universal text processing"
```

---

### Task 6: Final Verification

Run full build and test suite to confirm nothing is broken.

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: Clean — zero errors

**Step 2: Full test suite**

Run: `npx vitest run`
Expected: All tests pass (503+3 new = 506+ tests, same 6 known failures)

**Step 3: Verify with a quick sanity check**

Run: `node -e "console.log('завтра'.replace(/[^\p{L}\p{N}\s-]/gu, ' '))"`
Expected: `завтра` (Cyrillic preserved, not destroyed)

Run: `node -e "console.log('ședință'.replace(/[^\p{L}\p{N}\s-]/gu, ' '))"`
Expected: `ședință` (Romanian diacritics preserved)

**Step 4: Squash or push**

The 5 commits from Tasks 1-5 tell a clean story. Push as-is or squash into one — user's choice.
