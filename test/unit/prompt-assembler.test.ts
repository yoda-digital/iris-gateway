import { describe, it, expect, vi } from "vitest";
import type { ArcLifecycle } from "../../src/intelligence/arcs/lifecycle.js";
import type { GoalLifecycle } from "../../src/intelligence/goals/lifecycle.js";
import type { OutcomeAnalyzer } from "../../src/intelligence/outcomes/analyzer.js";
import type { CrossChannelResolver } from "../../src/intelligence/cross-channel/resolver.js";
import type { HealthGate } from "../../src/intelligence/health/gate.js";
import type { TriggerResult } from "../../src/intelligence/types.js";
import { PromptAssembler } from "../../src/intelligence/prompt-assembler.js";

// Helper: build a mock OutcomeAnalyzer with configurable summary
function mockOutcomes(summary: {
  rates: { category: string; rate: number; count: number }[];
  timing: { bestHours: number[] };
  topCategory: string | null;
  worstCategory: string | null;
}): OutcomeAnalyzer {
  return {
    getSummary: vi.fn().mockReturnValue(summary),
  } as unknown as OutcomeAnalyzer;
}

describe("PromptAssembler — language injection", () => {
  it("passes userLanguage to getGoalContext", () => {
    const mockGoals = {
      getGoalContext: vi.fn().mockReturnValue("[USER GOALS]\nActive:\n  - Fix the bug"),
    } as unknown as GoalLifecycle;
    const assembler = new PromptAssembler(null, mockGoals, null, null, null);
    assembler.assemble("user-1", undefined, "ro");
    expect(mockGoals.getGoalContext).toHaveBeenCalledWith("user-1", "ro");
  });

  it("works without language (backward compat)", () => {
    const mockGoals = {
      getGoalContext: vi.fn().mockReturnValue(null),
    } as unknown as GoalLifecycle;
    const assembler = new PromptAssembler(null, mockGoals, null, null, null);
    expect(() => assembler.assemble("user-1")).not.toThrow();
    expect(mockGoals.getGoalContext).toHaveBeenCalledWith("user-1", undefined);
  });
});

describe("GoalLifecycle.getGoalContext — language directive", () => {
  it("includes language directive when userLanguage provided", async () => {
    const { GoalLifecycle } = await import("../../src/intelligence/goals/lifecycle.js");
    const mockStore = {
      getActiveGoals: vi.fn().mockReturnValue([
        { id: "g1", description: "Test goal", priority: 50, nextActionDue: null, nextAction: null, successCriteria: null },
      ]),
      getPausedGoals: vi.fn().mockReturnValue([]),
    };
    const mockBus = { emit: vi.fn() };
    const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const lifecycle = new GoalLifecycle(mockStore as any, mockBus as any, mockLogger as any);
    const context = lifecycle.getGoalContext("user-1", "ro");
    expect(context).toContain("LANGUAGE");
    expect(context).toContain("ro");
  });
});

// ─── buildProactiveContext branches ──────────────────────────────────────────

describe("PromptAssembler.buildProactiveContext", () => {
  it("returns null when outcomes is null", () => {
    const assembler = new PromptAssembler(null, null, null, null, null);
    const sections = assembler.assemble("user-1");
    expect(sections.proactiveContext).toBeNull();
  });

  it("returns null when rates array is empty", () => {
    const outcomes = mockOutcomes({ rates: [], timing: { bestHours: [] }, topCategory: null, worstCategory: null });
    const assembler = new PromptAssembler(null, null, outcomes, null, null);
    expect(assembler.assemble("user-1").proactiveContext).toBeNull();
  });

  it("returns null when only header line would be produced (no qualifying branches)", () => {
    // topCategory present but count < 3 → no best category line → only header → null
    const outcomes = mockOutcomes({
      rates: [{ category: "news", rate: 0.8, count: 2 }],
      timing: { bestHours: [] },
      topCategory: "news",
      worstCategory: null,
    });
    const assembler = new PromptAssembler(null, null, outcomes, null, null);
    expect(assembler.assemble("user-1").proactiveContext).toBeNull();
  });

  it("includes best category when count >= 3", () => {
    const outcomes = mockOutcomes({
      rates: [{ category: "weather", rate: 0.75, count: 5 }],
      timing: { bestHours: [] },
      topCategory: "weather",
      worstCategory: null,
    });
    const assembler = new PromptAssembler(null, null, outcomes, null, null);
    const ctx = assembler.assemble("user-1").proactiveContext;
    expect(ctx).toContain("Best category: weather");
    expect(ctx).toContain("75%");
  });

  it("omits best category when count < 3", () => {
    const outcomes = mockOutcomes({
      rates: [
        { category: "weather", rate: 0.75, count: 2 },
        { category: "sports", rate: 0.1, count: 5 },
      ],
      timing: { bestHours: [9] },
      topCategory: "weather",
      worstCategory: "sports",
    });
    const assembler = new PromptAssembler(null, null, outcomes, null, null);
    const ctx = assembler.assemble("user-1").proactiveContext;
    expect(ctx).not.toContain("Best category");
  });

  it("skips worst category when it equals top category", () => {
    const outcomes = mockOutcomes({
      rates: [{ category: "news", rate: 0.1, count: 5 }],
      timing: { bestHours: [] },
      topCategory: "news",
      worstCategory: "news",
    });
    const assembler = new PromptAssembler(null, null, outcomes, null, null);
    const ctx = assembler.assemble("user-1").proactiveContext;
    expect(ctx).not.toContain("Avoid:");
  });

  it("includes worst category when rate < 0.3 and count >= 3", () => {
    const outcomes = mockOutcomes({
      rates: [
        { category: "weather", rate: 0.9, count: 10 },
        { category: "sports", rate: 0.1, count: 5 },
      ],
      timing: { bestHours: [] },
      topCategory: "weather",
      worstCategory: "sports",
    });
    const assembler = new PromptAssembler(null, null, outcomes, null, null);
    const ctx = assembler.assemble("user-1").proactiveContext;
    expect(ctx).toContain("Avoid: sports");
    expect(ctx).toContain("10%");
  });

  it("omits worst category when worstRate.count < 3", () => {
    const outcomes = mockOutcomes({
      rates: [
        { category: "weather", rate: 0.9, count: 10 },
        { category: "sports", rate: 0.1, count: 2 },
      ],
      timing: { bestHours: [] },
      topCategory: "weather",
      worstCategory: "sports",
    });
    const assembler = new PromptAssembler(null, null, outcomes, null, null);
    const ctx = assembler.assemble("user-1").proactiveContext;
    expect(ctx).not.toContain("Avoid:");
  });

  it("omits worst category when worstRate.rate >= 0.3", () => {
    const outcomes = mockOutcomes({
      rates: [
        { category: "weather", rate: 0.9, count: 10 },
        { category: "sports", rate: 0.35, count: 5 },
      ],
      timing: { bestHours: [] },
      topCategory: "weather",
      worstCategory: "sports",
    });
    const assembler = new PromptAssembler(null, null, outcomes, null, null);
    const ctx = assembler.assemble("user-1").proactiveContext;
    expect(ctx).not.toContain("Avoid:");
  });

  it("includes best hours (up to 3)", () => {
    const outcomes = mockOutcomes({
      rates: [{ category: "news", rate: 0.9, count: 5 }],
      timing: { bestHours: [8, 12, 18, 21] },
      topCategory: "news",
      worstCategory: null,
    });
    const assembler = new PromptAssembler(null, null, outcomes, null, null);
    const ctx = assembler.assemble("user-1").proactiveContext;
    expect(ctx).toContain("Best hours: 8:00, 12:00, 18:00");
    expect(ctx).not.toContain("21:00");
  });
});

// ─── buildTriggerFlags branches ──────────────────────────────────────────────

describe("PromptAssembler.buildTriggerFlags", () => {
  it("returns null when triggerFlags is undefined", () => {
    const assembler = new PromptAssembler(null, null, null, null, null);
    expect(assembler.assemble("user-1").triggerFlags).toBeNull();
  });

  it("returns null when triggerFlags is empty array", () => {
    const assembler = new PromptAssembler(null, null, null, null, null);
    expect(assembler.assemble("user-1", []).triggerFlags).toBeNull();
  });

  it("returns null when no triggers have flag_for_prompt action", () => {
    const triggers: TriggerResult[] = [
      { ruleId: "r1", action: "create_intent", payload: { flag: "MY_FLAG" } },
      { ruleId: "r2", action: "update_signal", payload: { flag: "OTHER_FLAG" } },
    ];
    const assembler = new PromptAssembler(null, null, null, null, null);
    expect(assembler.assemble("user-1", triggers).triggerFlags).toBeNull();
  });

  it("returns flag lines for flag_for_prompt triggers", () => {
    const triggers: TriggerResult[] = [
      { ruleId: "r1", action: "flag_for_prompt", payload: { flag: "ENGAGE_USER" } },
      { ruleId: "r2", action: "flag_for_prompt", payload: { flag: "OFFER_HELP" } },
    ];
    const assembler = new PromptAssembler(null, null, null, null, null);
    const flags = assembler.assemble("user-1", triggers).triggerFlags;
    expect(flags).toContain("ENGAGE_USER");
    expect(flags).toContain("OFFER_HELP");
  });

  it("filters out non-flag_for_prompt from mixed actions", () => {
    const triggers: TriggerResult[] = [
      { ruleId: "r1", action: "create_intent", payload: { flag: "IGNORED" } },
      { ruleId: "r2", action: "flag_for_prompt", payload: { flag: "INCLUDED" } },
    ];
    const assembler = new PromptAssembler(null, null, null, null, null);
    const flags = assembler.assemble("user-1", triggers).triggerFlags;
    expect(flags).toContain("INCLUDED");
    expect(flags).not.toContain("IGNORED");
  });

  it("handles missing flag key in payload gracefully", () => {
    const triggers: TriggerResult[] = [
      { ruleId: "r1", action: "flag_for_prompt", payload: {} },
    ];
    const assembler = new PromptAssembler(null, null, null, null, null);
    expect(assembler.assemble("user-1", triggers).triggerFlags).toBeNull();
  });
});

// ─── render method ───────────────────────────────────────────────────────────

describe("PromptAssembler.render", () => {
  it("returns null when all sections are null", () => {
    const assembler = new PromptAssembler(null, null, null, null, null);
    expect(assembler.render("user-1")).toBeNull();
  });

  it("joins non-null sections with double newline", () => {
    const mockArcs = { getArcContext: vi.fn().mockReturnValue("[ARC]") } as unknown as ArcLifecycle;
    const mockGoals = { getGoalContext: vi.fn().mockReturnValue("[GOALS]") } as unknown as GoalLifecycle;
    const assembler = new PromptAssembler(mockArcs, mockGoals, null, null, null);
    const rendered = assembler.render("user-1");
    expect(rendered).toBe("[ARC]\n\n[GOALS]");
  });

  it("includes all non-null sections", () => {
    const mockArcs = { getArcContext: vi.fn().mockReturnValue("ARC") } as unknown as ArcLifecycle;
    const mockCrossChannel = { getContextForPrompt: vi.fn().mockReturnValue("CROSS") } as unknown as CrossChannelResolver;
    const mockHealth = { getHealthHints: vi.fn().mockReturnValue("HEALTH") } as unknown as HealthGate;
    const assembler = new PromptAssembler(mockArcs, null, null, mockCrossChannel, mockHealth);
    const rendered = assembler.render("user-1");
    expect(rendered).toContain("ARC");
    expect(rendered).toContain("CROSS");
    expect(rendered).toContain("HEALTH");
  });
});
