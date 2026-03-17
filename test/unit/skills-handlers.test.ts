import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildHandlerDirs,
  buildIrisContext,
  handleSkillCreate,
  handleSkillList,
  handleSkillDelete,
  handleSkillValidate,
  handleSkillSuggest,
  handleAgentCreate,
  handleAgentList,
  handleAgentDelete,
  handleRulesRead,
  handleToolsList,
  IRIS_TOOL_CATALOG,
} from "../../src/bridge/routers/skills-handlers.js";

// Minimal Context mock factory
function makeCtx(body: unknown = {}, params: Record<string, string> = {}) {
  const responses: Array<{ body: unknown; status?: number }> = [];
  const ctx = {
    req: {
      json: vi.fn().mockResolvedValue(body),
      param: (k: string) => params[k],
    },
    json: vi.fn().mockImplementation((b: unknown, status?: number) => {
      responses.push({ body: b, status });
      return { body: b, status };
    }),
    _responses: responses,
  };
  return ctx as any;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "iris-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeDirs(overrides: Partial<ReturnType<typeof buildHandlerDirs>> = {}): ReturnType<typeof buildHandlerDirs> {
  return {
    skillsDir: join(tmpDir, "skills"),
    agentsDir: join(tmpDir, "agents"),
    rulesFile: join(tmpDir, "AGENTS.md"),
    customToolsDir: join(tmpDir, "tools"),
    irisToolCatalog: [...IRIS_TOOL_CATALOG],
    ...overrides,
  };
}

// ===== buildHandlerDirs =====
describe("buildHandlerDirs", () => {
  it("resolves dirs relative to workingDir", () => {
    const dirs = buildHandlerDirs({ workingDir: "/mock/root" });
    expect(dirs.skillsDir).toContain("skills");
    expect(dirs.agentsDir).toContain("agents");
    expect(dirs.rulesFile).toContain("AGENTS.md");
  });

  it("includes IRIS_TOOL_CATALOG in irisToolCatalog", () => {
    const dirs = buildHandlerDirs({ workingDir: tmpDir });
    expect(dirs.irisToolCatalog.length).toBeGreaterThan(0);
    expect(dirs.irisToolCatalog.some(t => t.includes("send_message"))).toBe(true);
  });

  it("appends cliRegistry tools when provided", () => {
    const registry = {
      listTools: vi.fn().mockReturnValue(["my-tool"]),
      getToolDef: vi.fn().mockReturnValue({ description: "My custom tool" }),
    };
    const dirs = buildHandlerDirs({ workingDir: tmpDir, cliRegistry: registry as any });
    expect(dirs.irisToolCatalog.some(t => t.includes("my-tool"))).toBe(true);
  });
});

// ===== buildIrisContext =====
describe("buildIrisContext", () => {
  it("includes agent name and description", () => {
    const ctx = buildIrisContext("my-agent", "does things", join(tmpDir, "no-skills"), []);
    expect(ctx).toContain("my-agent");
    expect(ctx).toContain("does things");
  });
});

// ===== handleSkillCreate =====
describe("handleSkillCreate", () => {
  it("creates a skill and returns ok", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ name: "my-skill", description: "Test skill" });
    await handleSkillCreate(ctx, {}, dirs);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("returns 400 for invalid skill name", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ name: "Bad_Name", description: "Test" });
    await handleSkillCreate(ctx, {}, dirs);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
  });

  it("returns 400 when description is missing", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ name: "good-name" });
    await handleSkillCreate(ctx, {}, dirs);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("description") }), 400);
  });

  it("returns 403 when policy engine rejects", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ name: "blocked-skill", description: "forbidden" });
    const policyEngine = {
      enabled: true,
      validateSkillCreation: vi.fn().mockReturnValue([{ level: "error", code: "POL001", message: "forbidden" }]),
    };
    await handleSkillCreate(ctx, { policyEngine: policyEngine as any }, dirs);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Policy violation" }), 403);
  });
});

// ===== handleSkillList =====
describe("handleSkillList", () => {
  it("returns empty array when skills dir does not exist", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx();
    handleSkillList(ctx, dirs);
    expect(ctx.json).toHaveBeenCalledWith({ skills: [] });
  });

  it("lists created skills", async () => {
    const dirs = makeDirs();
    // Create a skill first
    await handleSkillCreate(makeCtx({ name: "demo", description: "A demo skill" }), {}, dirs);
    const ctx = makeCtx();
    handleSkillList(ctx, dirs);
    const call = ctx.json.mock.calls[0][0];
    expect(call.skills.length).toBe(1);
    expect(call.skills[0].name).toBe("demo");
  });
});

// ===== handleSkillDelete =====
describe("handleSkillDelete", () => {
  it("deletes an existing skill", async () => {
    const dirs = makeDirs();
    await handleSkillCreate(makeCtx({ name: "to-delete", description: "temp" }), {}, dirs);
    const ctx = makeCtx({ name: "to-delete" });
    await handleSkillDelete(ctx, dirs);
    expect(ctx.json).toHaveBeenCalledWith({ ok: true });
  });

  it("returns 404 for non-existent skill", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ name: "ghost" });
    await handleSkillDelete(ctx, dirs);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Skill not found" }), 404);
  });

  it("returns 400 when name is missing", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({});
    await handleSkillDelete(ctx, dirs);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: "name required" }), 400);
  });
});

// ===== handleSkillValidate =====
describe("handleSkillValidate", () => {
  it("returns valid for a properly structured skill", async () => {
    const dirs = makeDirs();
    await handleSkillCreate(makeCtx({ name: "valid-skill", description: "My skill description" }), {}, dirs);
    const ctx = makeCtx({ name: "valid-skill" });
    await handleSkillValidate(ctx, dirs);
    const result = ctx.json.mock.calls[0][0];
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns invalid for non-existent skill", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ name: "missing" });
    await handleSkillValidate(ctx, dirs);
    const result = ctx.json.mock.calls[0][0];
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns error when name is missing", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({});
    await handleSkillValidate(ctx, dirs);
    const result = ctx.json.mock.calls[0][0];
    expect(result.valid).toBe(false);
  });
});

// ===== handleSkillSuggest =====
describe("handleSkillSuggest", () => {
  it("returns empty suggestions when no skills dir", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ text: "weather" });
    await handleSkillSuggest(ctx, dirs);
    expect(ctx.json).toHaveBeenCalledWith({ suggestions: [] });
  });

  it("returns matching suggestions by triggers", async () => {
    const dirs = makeDirs();
    await handleSkillCreate(
      makeCtx({ name: "weather-skill", description: "Weather info", triggers: "weather,forecast" }),
      {},
      dirs,
    );
    const ctx = makeCtx({ text: "what is the weather today" });
    await handleSkillSuggest(ctx, dirs);
    const result = ctx.json.mock.calls[0][0];
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].name).toBe("weather-skill");
  });
});

// ===== handleAgentCreate + handleAgentList + handleAgentDelete =====
describe("handleAgentCreate / handleAgentList / handleAgentDelete", () => {
  it("creates agent and lists it", async () => {
    const dirs = makeDirs();
    await handleAgentCreate(makeCtx({ name: "my-agent", description: "Does stuff" }), {}, dirs);
    const ctx = makeCtx();
    handleAgentList(ctx, dirs);
    const result = ctx.json.mock.calls[0][0];
    expect(result.agents.length).toBe(1);
    expect(result.agents[0].name).toBe("my-agent");
  });

  it("returns 400 for invalid agent name", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ name: "Bad Agent", description: "..." });
    await handleAgentCreate(ctx, {}, dirs);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
  });

  it("returns 400 when agent description is missing", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ name: "ok-name" });
    await handleAgentCreate(ctx, {}, dirs);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }), 400);
  });

  it("deletes existing agent", async () => {
    const dirs = makeDirs();
    await handleAgentCreate(makeCtx({ name: "temp-agent", description: "To be removed" }), {}, dirs);
    const ctx = makeCtx({ name: "temp-agent" });
    await handleAgentDelete(ctx, dirs);
    expect(ctx.json).toHaveBeenCalledWith({ ok: true });
  });

  it("returns 404 when deleting non-existent agent", async () => {
    const dirs = makeDirs();
    const ctx = makeCtx({ name: "ghost-agent" });
    await handleAgentDelete(ctx, dirs);
    expect(ctx.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Agent not found" }), 404);
  });

  it("returns empty list when agents dir does not exist", () => {
    const dirs = makeDirs();
    const ctx = makeCtx();
    handleAgentList(ctx, dirs);
    expect(ctx.json).toHaveBeenCalledWith({ agents: [] });
  });
});

// ===== handleRulesRead =====
describe("handleRulesRead", () => {
  it("returns empty rules when AGENTS.md does not exist", () => {
    const dirs = makeDirs();
    const ctx = makeCtx();
    handleRulesRead(ctx, dirs);
    const result = ctx.json.mock.calls[0][0];
    expect(result).toHaveProperty("exists");
  });
});

// ===== handleToolsList =====
describe("handleToolsList", () => {
  it("returns the iris tool catalog", () => {
    const dirs = makeDirs();
    const ctx = makeCtx();
    handleToolsList(ctx, dirs);
    const result = ctx.json.mock.calls[0][0];
    expect(result).toHaveProperty("tools");
    expect(Array.isArray(result.tools)).toBe(true);
  });
});
