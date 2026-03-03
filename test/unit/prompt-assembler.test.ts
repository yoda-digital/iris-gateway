import { describe, it, expect, vi } from "vitest";
import type { ArcLifecycle } from "../../src/intelligence/arcs/lifecycle.js";
import type { GoalLifecycle } from "../../src/intelligence/goals/lifecycle.js";
import { PromptAssembler } from "../../src/intelligence/prompt-assembler.js";

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
