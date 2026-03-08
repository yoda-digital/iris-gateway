/**
 * Comprehensive unit tests for src/bridge/routers/skills.ts
 * Uses Hono app.request() -- NO live server, NO ports.
 * baseDir passed via SkillsDeps for full isolation.
 * Addressing issue #72.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { skillsRouter } from "../../src/bridge/routers/skills.js";

function makeApp(baseDir: string, policyEngine?: unknown) {
  const app = new Hono();
  app.route("/", skillsRouter({ baseDir, policyEngine: policyEngine as any }));
  return app;
}

async function get(app: Hono, path: string) {
  return app.request(path, { method: "GET" });
}

async function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let baseDir: string;
let skillsDir: string;
let agentsDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "iris-skills-router-"));
  skillsDir = join(baseDir, ".opencode", "skills");
  agentsDir = join(baseDir, ".opencode", "agents");
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

// helper: create a valid SKILL.md
function mkSkill(name: string, desc = "Test skill", extra = "") {
  mkdirSync(join(skillsDir, name), { recursive: true });
  writeFileSync(
    join(skillsDir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\n${extra || "Body content with vault references for checks."}`,
  );
}

// ─── POST /skills/create ─────────────────────────────────────────────────────

describe("POST /skills/create", () => {
  it("happy path -- creates SKILL.md on disk and returns ok:true", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/create", { name: "my-skill", description: "Does something useful" });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; path: string };
    expect(body.ok).toBe(true);
    expect(body.path).toContain("my-skill");
    const skillMd = join(skillsDir, "my-skill", "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
    const c = readFileSync(skillMd, "utf-8");
    expect(c).toContain("name: my-skill");
    expect(c).toContain("description: Does something useful");
  });

  it("returns 400 when description is missing", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/create", { name: "my-skill" });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/description/i);
  });

  it("returns 400 when name is invalid", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/create", { name: "Invalid Name!", description: "test" });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid skill name/i);
  });

  it("returns 400 for path traversal in name", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/create", { name: "../evil", description: "mal" });
    expect(res.status).toBe(400);
  });

  it("returns 403 when policy blocks creation", async () => {
    const mockPolicy = {
      enabled: true,
      validateSkillCreation: () => [{ level: "error", code: "BLOCKED", message: "Not allowed" }],
      validateAgentCreation: () => [],
      getConfig: () => ({ agents: { defaultTools: [] } }),
    };
    const app = makeApp(baseDir, mockPolicy);
    const res = await post(app, "/skills/create", { name: "blocked-skill", description: "blocked" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; violations: string[] };
    expect(body.error).toMatch(/policy violation/i);
    expect(body.violations).toHaveLength(1);
    expect(body.violations[0]).toContain("[BLOCKED]");
  });
});

// ─── GET /skills/list ────────────────────────────────────────────────────────

describe("GET /skills/list", () => {
  it("returns empty array when skills dir missing", async () => {
    const app = makeApp(baseDir);
    const res = await get(app, "/skills/list");
    expect(res.status).toBe(200);
    const body = await res.json() as { skills: unknown[] };
    expect(body.skills).toHaveLength(0);
  });

  it("returns correct payload for existing skills", async () => {
    mkdirSync(join(skillsDir, "test-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "test-skill", "SKILL.md"), [
      "---",
      "name: test-skill",
      "description: A test skill",
      "metadata:",
      `  triggers: "keyword1, keyword2"`,
      `  auto: "true"`,
      "---",
      "",
      "Do stuff.",
    ].join("\n"));
    const app = makeApp(baseDir);
    const res = await get(app, "/skills/list");
    expect(res.status).toBe(200);
    const body = await res.json() as { skills: Array<{ name: string; description: string; triggers: string|null; auto: boolean; path: string }> };
    expect(body.skills).toHaveLength(1);
    const s = body.skills[0];
    expect(s.name).toBe("test-skill");
    expect(s.description).toBe("A test skill");
    expect(s.triggers).toBe("keyword1, keyword2");
    expect(s.auto).toBe(true);
    expect(s.path).toContain("SKILL.md");
  });
});

// ─── POST /skills/delete ─────────────────────────────────────────────────────

describe("POST /skills/delete", () => {
  it("happy path -- removes skill directory", async () => {
    mkSkill("to-delete");
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/delete", { name: "to-delete" });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(existsSync(join(skillsDir, "to-delete"))).toBe(false);
  });

  it("returns 400 when name missing", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/delete", {});
    expect(res.status).toBe(400);
  });

  it("returns 404 when skill not found", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/delete", { name: "ghost" });
    expect(res.status).toBe(404);
  });
});

// ─── POST /skills/validate ───────────────────────────────────────────────────

describe("POST /skills/validate", () => {
  it("returns valid:false when name missing", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/validate", {});
    const body = await res.json() as { valid: boolean; errors: string[] };
    expect(body.valid).toBe(false);
    expect(body.errors).toContain("name required");
  });

  it("returns valid:false when SKILL.md missing", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/validate", { name: "nonexistent" });
    const body = await res.json() as { valid: boolean; errors: string[] };
    expect(body.valid).toBe(false);
    expect(body.errors[0]).toMatch(/SKILL\.md not found/i);
  });

  it("returns valid:true for well-formed skill", async () => {
    mkSkill("good-skill", "well formed", "Do stuff with vault and more content.\ntriggers: listed in meta\n");
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/validate", { name: "good-skill" });
    const body = await res.json() as { valid: boolean; errors: string[] };
    expect(body.valid).toBe(true);
    expect(body.errors).toHaveLength(0);
  });

  it("returns errors for malformed skill", async () => {
    mkdirSync(join(skillsDir, "bad-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "bad-skill", "SKILL.md"), "no frontmatter at all");
    const app = makeApp(baseDir);
    const res = await post(app, "/skills/validate", { name: "bad-skill" });
    const body = await res.json() as { valid: boolean; errors: string[] };
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

// ─── POST /agents/create ─────────────────────────────────────────────────────

describe("POST /agents/create", () => {
  it("happy path with explicit skills list", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/create", {
      name: "my-agent",
      description: "A helpful agent",
      skills: ["skill-a", "skill-b"],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; path: string };
    expect(body.ok).toBe(true);
    const c = readFileSync(join(agentsDir, "my-agent.md"), "utf-8");
    expect(c).toContain("skill-a");
    expect(c).toContain("skill-b");
    expect(c).toContain("description: A helpful agent");
  });

  it("auto-discovers all skills when none specified (surprising default)", async () => {
    mkSkill("alpha", "Alpha skill");
    mkSkill("beta", "Beta skill");
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/create", {
      name: "auto-agent",
      description: "Auto discovers",
      // NOTE: no skills field
    });
    expect(res.status).toBe(200);
    const c = readFileSync(join(agentsDir, "auto-agent.md"), "utf-8");
    expect(c).toContain("alpha");
    expect(c).toContain("beta");
  });

  it("returns 400 when description missing", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/create", { name: "bad-agent" });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/description/i);
  });

  it("returns 400 when name invalid", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/create", { name: "BAD NAME", description: "x" });
    expect(res.status).toBe(400);
  });

  it("returns 403 when policy blocks creation", async () => {
    const mockPolicy = {
      enabled: true,
      validateAgentCreation: () => [{ level: "error", code: "AGENT_BLOCKED", message: "Not allowed" }],
      validateSkillCreation: () => [],
      getConfig: () => ({ agents: { defaultTools: [] } }),
    };
    const app = makeApp(baseDir, mockPolicy);
    const res = await post(app, "/agents/create", { name: "blocked-agent", description: "blocked" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/policy violation/i);
  });
});

// ─── GET /agents/list ────────────────────────────────────────────────────────

describe("GET /agents/list", () => {
  it("returns empty array when agents dir missing", async () => {
    const app = makeApp(baseDir);
    const res = await get(app, "/agents/list");
    expect(res.status).toBe(200);
    const body = await res.json() as { agents: unknown[] };
    expect(body.agents).toHaveLength(0);
  });

  it("returns correct payload structure", async () => {
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "test-bot.md"), [
      "---",
      "description: A test bot",
      "mode: subagent",
      "tools:",
      "  skill: true",
      "skills:",
      "  - my-skill",
      "---",
      "",
      "You are test bot.",
    ].join("\n"));
    const app = makeApp(baseDir);
    const res = await get(app, "/agents/list");
    expect(res.status).toBe(200);
    const body = await res.json() as { agents: Array<{ name: string; mode: string; description: string; disabled: boolean; hidden: boolean }> };
    expect(body.agents).toHaveLength(1);
    const a = body.agents[0];
    expect(a.name).toBe("test-bot");
    expect(a.mode).toBe("subagent");
    expect(a.description).toBe("A test bot");
    expect(a.disabled).toBe(false);
    expect(a.hidden).toBe(false);
  });
});

// ─── POST /agents/delete ─────────────────────────────────────────────────────

describe("POST /agents/delete", () => {
  it("happy path -- removes agent file", async () => {
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "bye-bot.md"), "---\ndescription: bye\nmode: subagent\n---\n");
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/delete", { name: "bye-bot" });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(existsSync(join(agentsDir, "bye-bot.md"))).toBe(false);
  });

  it("returns 400 when name missing", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/delete", {});
    expect(res.status).toBe(400);
  });

  it("returns 404 when agent not found", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/delete", { name: "ghost-bot" });
    expect(res.status).toBe(404);
  });
});

// ─── POST /agents/validate ───────────────────────────────────────────────────

describe("POST /agents/validate", () => {
  it("returns valid:false when name missing", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/validate", {});
    const body = await res.json() as { valid: boolean; errors: string[] };
    expect(body.valid).toBe(false);
    expect(body.errors).toContain("name required");
  });

  it("returns valid:false when agent file missing", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/validate", { name: "nonexistent" });
    const body = await res.json() as { valid: boolean; errors: string[] };
    expect(body.valid).toBe(false);
    expect(body.errors[0]).toMatch(/not found/i);
  });

  it("returns valid:true for well-formed agent", async () => {
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "good-bot.md"), [
      "---",
      "description: Good bot description",
      "mode: subagent",
      "tools:",
      "  skill: true",
      "skills:",
      "  - my-skill",
      "---",
      "",
      "You are good bot. Use vault_search to recall context. Long enough prompt body here.",
    ].join("\n"));
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/validate", { name: "good-bot" });
    const body = await res.json() as { valid: boolean; errors: string[] };
    expect(body.valid).toBe(true);
    expect(body.errors).toHaveLength(0);
  });

  it("returns errors for malformed agent", async () => {
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "bad-bot.md"), "no frontmatter");
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/validate", { name: "bad-bot" });
    const body = await res.json() as { valid: boolean; errors: string[] };
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

// ─── GET /rules/read ─────────────────────────────────────────────────────────

describe("GET /rules/read", () => {
  it("returns content when AGENTS.md exists", async () => {
    writeFileSync(join(baseDir, "AGENTS.md"), "# Rules\nDo good things.");
    const app = makeApp(baseDir);
    const res = await get(app, "/rules/read");
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; exists: boolean };
    expect(body.exists).toBe(true);
    expect(body.content).toContain("Do good things.");
  });

  it("returns exists:false when AGENTS.md missing", async () => {
    const app = makeApp(baseDir);
    const res = await get(app, "/rules/read");
    expect(res.status).toBe(200);
    const body = await res.json() as { content: null; exists: boolean };
    expect(body.exists).toBe(false);
    expect(body.content).toBeNull();
  });
});

// ─── POST /rules/update ──────────────────────────────────────────────────────

describe("POST /rules/update", () => {
  it("overwrites AGENTS.md", async () => {
    writeFileSync(join(baseDir, "AGENTS.md"), "old");
    const app = makeApp(baseDir);
    const res = await post(app, "/rules/update", { content: "new content" });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(readFileSync(join(baseDir, "AGENTS.md"), "utf-8")).toBe("new content");
  });

  it("returns 400 when content not a string", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/rules/update", { content: 123 });
    expect(res.status).toBe(400);
  });
});

// ─── POST /rules/append ──────────────────────────────────────────────────────

describe("POST /rules/append", () => {
  /**
   * Edge case 1: empty file.
   * separator = existing.endsWith("\n") || !existing ? "" : "\n"
   * When existing = "", !existing is true => separator = ""
   */
  it("appends to empty file with no separator", async () => {
    writeFileSync(join(baseDir, "AGENTS.md"), "");
    const app = makeApp(baseDir);
    const res = await post(app, "/rules/append", { section: "## New Section" });
    expect(res.status).toBe(200);
    const c = readFileSync(join(baseDir, "AGENTS.md"), "utf-8");
    expect(c).toContain("## New Section");
    // Empty string + "" + "\n" + section — should not start with double newline
    expect(c).not.toMatch(/^\n\n/);
  });

  /**
   * Edge case 2: file ends with \n => separator = ""
   */
  it("appends to file with trailing newline -- no extra separator", async () => {
    writeFileSync(join(baseDir, "AGENTS.md"), "# Existing\nContent\n");
    const app = makeApp(baseDir);
    const res = await post(app, "/rules/append", { section: "## Appended" });
    expect(res.status).toBe(200);
    const c = readFileSync(join(baseDir, "AGENTS.md"), "utf-8");
    expect(c).toContain("# Existing");
    expect(c).toContain("## Appended");
    // existing ends with \n, separator="", so: "...\n" + "" + "\n" + section
    const idx = c.indexOf("## Appended");
    expect(c.slice(idx - 1, idx)).toBe("\n");
  });

  /**
   * Edge case 3: file does NOT end with \n => separator = "\n"
   */
  it("appends to file without trailing newline -- adds separator \\n", async () => {
    writeFileSync(join(baseDir, "AGENTS.md"), "# Existing\nNo trailing newline");
    const app = makeApp(baseDir);
    const res = await post(app, "/rules/append", { section: "## Appended" });
    expect(res.status).toBe(200);
    const c = readFileSync(join(baseDir, "AGENTS.md"), "utf-8");
    expect(c).toContain("# Existing");
    expect(c).toContain("## Appended");
    // separator="\n", so: existing + "\n" + "\n" + section => two \n before section
    const idx = c.indexOf("## Appended");
    expect(c.slice(idx - 2, idx)).toBe("\n\n");
  });

  it("returns 400 when section missing", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/rules/append", {});
    expect(res.status).toBe(400);
  });
});

// ─── GET /tools/list ─────────────────────────────────────────────────────────

describe("GET /tools/list", () => {
  it("returns empty list when tools dir missing", async () => {
    const app = makeApp(baseDir);
    const res = await get(app, "/tools/list");
    expect(res.status).toBe(200);
    const body = await res.json() as { tools: unknown[]; dir: string };
    expect(body.tools).toHaveLength(0);
    expect(body.dir).toContain("tools");
  });

  it("returns ts/js/mjs files, ignores others", async () => {
    const toolsDir = join(baseDir, ".opencode", "tools");
    mkdirSync(toolsDir, { recursive: true });
    writeFileSync(join(toolsDir, "my-tool.ts"), "export default {}");
    writeFileSync(join(toolsDir, "other.js"), "module.exports = {}");
    writeFileSync(join(toolsDir, "README.md"), "ignored");
    const app = makeApp(baseDir);
    const res = await get(app, "/tools/list");
    const body = await res.json() as { tools: Array<{ name: string; type: string }> };
    expect(body.tools).toHaveLength(2);
    const names = body.tools.map(t => t.name);
    expect(names).toContain("my-tool");
    expect(names).toContain("other");
    expect(body.tools.find(t => t.name === "my-tool")?.type).toBe("ts");
  });
});

// ─── POST /tools/create ──────────────────────────────────────────────────────

describe("POST /tools/create", () => {
  it("scaffolds tool file with correct structure", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/tools/create", {
      name: "weather-tool",
      description: "Gets weather",
      args: [
        { name: "city", type: "string", description: "City", required: true },
        { name: "units", type: "string", description: "Units", required: false },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    const toolPath = join(baseDir, ".opencode", "tools", "weather-tool.ts");
    expect(existsSync(toolPath)).toBe(true);
    const c = readFileSync(toolPath, "utf-8");
    expect(c).toContain(`name: "weather-tool"`);
    expect(c).toContain("city: z.string()");
    expect(c).toContain("units: z.string().optional()");
  });

  it("returns 400 for invalid tool name", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/tools/create", { name: "Bad Tool", description: "bad" });
    expect(res.status).toBe(400);
  });
});

// ─── buildIrisContext (via /agents/create) ───────────────────────────────────

describe("buildIrisContext (via /agents/create)", () => {
  it("injects available skills into agent prompt", async () => {
    mkSkill("my-skill", "My skill description");
    const app = makeApp(baseDir);
    await post(app, "/agents/create", { name: "ctx-agent", description: "Tests context" });
    const c = readFileSync(join(agentsDir, "ctx-agent.md"), "utf-8");
    expect(c).toContain("my-skill");
    expect(c).toContain("Available Skills");
  });

  it("does not crash when skills dir missing (silent swallow)", async () => {
    const app = makeApp(baseDir);
    const res = await post(app, "/agents/create", { name: "no-skills-agent", description: "Works without skills" });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    const c = readFileSync(join(agentsDir, "no-skills-agent.md"), "utf-8");
    expect(c).not.toContain("## Available Skills");
  });
});
