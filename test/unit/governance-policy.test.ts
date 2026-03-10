/**
 * Unit tests for src/governance/policy.ts — PolicyEngine
 * Issue #111 — governance/policy.ts at 6.27% coverage
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PolicyEngine } from "../../src/governance/policy.js";
import type { PolicyConfig } from "../../src/config/types.js";

function makeConfig(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    enabled: true,
    tools: { allowed: [], denied: [] },
    enforcement: { blockUnknownTools: false },
    permissions: { bash: "allow", edit: "allow", read: "allow" },
    agents: { allowedModes: ["subagent", "primary"], allowPrimaryCreation: true, requireDescription: false, maxSteps: 0 },
    skills: { restricted: [], requireTriggers: false },
    ...overrides,
  } as PolicyConfig;
}

describe("PolicyEngine", () => {
  it("enabled returns true/false per config", () => {
    expect(new PolicyEngine(makeConfig({ enabled: true })).enabled).toBe(true);
    expect(new PolicyEngine(makeConfig({ enabled: false })).enabled).toBe(false);
  });

  it("getConfig returns config", () => {
    const cfg = makeConfig();
    expect(new PolicyEngine(cfg).getConfig()).toBe(cfg);
  });

  describe("isToolAllowed", () => {
    it("allows everything when disabled", () => {
      expect(new PolicyEngine(makeConfig({ enabled: false })).isToolAllowed("bash")).toEqual({ allowed: true });
    });
    it("denies tool on denied list", () => {
      const r = new PolicyEngine(makeConfig({ tools: { allowed: [], denied: ["bash"] } })).isToolAllowed("bash");
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/explicitly denied/);
    });
    it("allows tool not on denied list", () => {
      expect(new PolicyEngine(makeConfig({ tools: { allowed: [], denied: ["bash"] } })).isToolAllowed("read")).toEqual({ allowed: true });
    });
    it("blocks unknown tool when blockUnknownTools=true and allowlist set", () => {
      const r = new PolicyEngine(makeConfig({ tools: { allowed: ["read"], denied: [] }, enforcement: { blockUnknownTools: true } })).isToolAllowed("bash");
      expect(r.allowed).toBe(false);
    });
    it("allows tool in allowlist with blockUnknownTools=true", () => {
      const r = new PolicyEngine(makeConfig({ tools: { allowed: ["read"], denied: [] }, enforcement: { blockUnknownTools: true } })).isToolAllowed("read");
      expect(r.allowed).toBe(true);
    });
    it("allows anything if allowlist empty even with blockUnknownTools=true", () => {
      expect(new PolicyEngine(makeConfig({ tools: { allowed: [], denied: [] }, enforcement: { blockUnknownTools: true } })).isToolAllowed("bash")).toEqual({ allowed: true });
    });
  });

  describe("isPermissionDenied", () => {
    it("returns false when disabled", () => {
      expect(new PolicyEngine(makeConfig({ enabled: false })).isPermissionDenied("bash")).toBe(false);
    });
    it("denies bash/edit/read when policy=deny", () => {
      const e = new PolicyEngine(makeConfig({ permissions: { bash: "deny", edit: "deny", read: "deny" } }));
      expect(e.isPermissionDenied("bash")).toBe(true);
      expect(e.isPermissionDenied("edit")).toBe(true);
      expect(e.isPermissionDenied("read")).toBe(true);
    });
    it("allows when policy=allow", () => {
      const e = new PolicyEngine(makeConfig());
      expect(e.isPermissionDenied("bash")).toBe(false);
    });
    it("unknown permission returns false", () => {
      expect(new PolicyEngine(makeConfig()).isPermissionDenied("network")).toBe(false);
    });
  });

  describe("validateAgentCreation", () => {
    it("returns empty when disabled", () => {
      expect(new PolicyEngine(makeConfig({ enabled: false })).validateAgentCreation({ name: "a" })).toEqual([]);
    });
    it("rejects disallowed mode", () => {
      const v = new PolicyEngine(makeConfig({ agents: { allowedModes: ["subagent"], allowPrimaryCreation: false, requireDescription: false, maxSteps: 0 } })).validateAgentCreation({ name: "a", mode: "primary" });
      expect(v.some(x => x.code === "AGENT_MODE_DENIED")).toBe(true);
    });
    it("rejects primary if allowPrimaryCreation=false", () => {
      const v = new PolicyEngine(makeConfig({ agents: { allowedModes: ["subagent", "primary"], allowPrimaryCreation: false, requireDescription: false, maxSteps: 0 } })).validateAgentCreation({ name: "a", mode: "primary" });
      expect(v.some(x => x.code === "AGENT_PRIMARY_DENIED")).toBe(true);
    });
    it("requires description when requireDescription=true", () => {
      const v = new PolicyEngine(makeConfig({ agents: { allowedModes: ["subagent"], allowPrimaryCreation: false, requireDescription: true, maxSteps: 0 } })).validateAgentCreation({ name: "a", description: "" });
      expect(v.some(x => x.code === "AGENT_DESCRIPTION_REQUIRED")).toBe(true);
    });
    it("rejects steps over maxSteps", () => {
      const v = new PolicyEngine(makeConfig({ agents: { allowedModes: ["subagent"], allowPrimaryCreation: false, requireDescription: false, maxSteps: 5 } })).validateAgentCreation({ name: "a", steps: 10 });
      expect(v.some(x => x.code === "AGENT_STEPS_EXCEEDED")).toBe(true);
    });
    it("rejects tool not in allowlist", () => {
      const v = new PolicyEngine(makeConfig({ tools: { allowed: ["read"], denied: [] } })).validateAgentCreation({ name: "a", tools: ["bash"] });
      expect(v.some(x => x.code === "AGENT_TOOL_NOT_ALLOWED")).toBe(true);
    });
    it("rejects denied tool", () => {
      const v = new PolicyEngine(makeConfig({ tools: { allowed: [], denied: ["bash"] } })).validateAgentCreation({ name: "a", tools: ["bash"] });
      expect(v.some(x => x.code === "AGENT_TOOL_DENIED")).toBe(true);
    });
    it("rejects restricted skill", () => {
      const v = new PolicyEngine(makeConfig({ skills: { restricted: ["hack"], requireTriggers: false } })).validateAgentCreation({ name: "a", skills: ["hack"] });
      expect(v.some(x => x.code === "AGENT_SKILL_RESTRICTED")).toBe(true);
    });
    it("detects permission weakening", () => {
      const v = new PolicyEngine(makeConfig({ permissions: { bash: "deny", edit: "allow", read: "allow" } })).validateAgentCreation({ name: "a", permission: { allow: { bash: "allow" } } });
      expect(v.some(x => x.code === "AGENT_PERM_WEAKENING")).toBe(true);
    });
    it("passes clean agent", () => {
      const v = new PolicyEngine(makeConfig()).validateAgentCreation({ name: "a", mode: "subagent", description: "test agent", tools: [] });
      expect(v).toHaveLength(0);
    });
  });

  describe("validateSkillCreation", () => {
    it("returns empty when disabled", () => {
      expect(new PolicyEngine(makeConfig({ enabled: false })).validateSkillCreation({ name: "x" })).toEqual([]);
    });
    it("rejects restricted skill name", () => {
      const v = new PolicyEngine(makeConfig({ skills: { restricted: ["hack"], requireTriggers: false } })).validateSkillCreation({ name: "hack" });
      expect(v.some(x => x.code === "SKILL_RESTRICTED")).toBe(true);
    });
    it("warns when triggers missing and requireTriggers=true", () => {
      const v = new PolicyEngine(makeConfig({ skills: { restricted: [], requireTriggers: true } })).validateSkillCreation({ name: "x" });
      expect(v.some(x => x.code === "SKILL_NO_TRIGGERS" && x.level === "warning")).toBe(true);
    });
    it("passes when triggers provided", () => {
      const v = new PolicyEngine(makeConfig({ skills: { restricted: [], requireTriggers: true } })).validateSkillCreation({ name: "x", triggers: "weather" });
      expect(v.find(x => x.code === "SKILL_NO_TRIGGERS")).toBeUndefined();
    });
  });

  describe("auditAll (filesystem)", () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = mkdtempSync("/tmp/policy-test-"); });
    afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

    it("returns empty when no dirs exist", () => {
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      expect(new PolicyEngine(makeConfig()).auditAll()).toEqual([]);
    });
    it("audits agent .md files", () => {
      const d = join(tmpDir, ".opencode", "agents"); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "my-agent.md"), "mode: subagent\ndescription: ok\n");
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const r = new PolicyEngine(makeConfig()).auditAll();
      expect(r.some(x => x.name === "my-agent" && x.type === "agent")).toBe(true);
    });
    it("marks compliant agent", () => {
      const d = join(tmpDir, ".opencode", "agents"); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "clean.md"), "mode: subagent\n");
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const r = new PolicyEngine(makeConfig()).auditAll().find(x => x.name === "clean");
      expect(r?.compliant).toBe(true);
    });
    it("detects denied tool in agent", () => {
      const d = join(tmpDir, ".opencode", "agents"); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "bad.md"), "mode: subagent\n  bash: true\n");
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const r = new PolicyEngine(makeConfig({ tools: { allowed: [], denied: ["bash"] } })).auditAll().find(x => x.name === "bad");
      expect(r?.compliant).toBe(false);
      expect(r?.violations.some(v => v.code === "AGENT_TOOL_DENIED")).toBe(true);
    });
    it("audits skill SKILL.md files", () => {
      const d = join(tmpDir, ".opencode", "skills", "my-skill"); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "SKILL.md"), "triggers: weather\n");
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const r = new PolicyEngine(makeConfig()).auditAll();
      expect(r.some(x => x.name === "my-skill" && x.type === "skill")).toBe(true);
    });
    it("detects restricted skill", () => {
      const d = join(tmpDir, ".opencode", "skills", "hack"); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "SKILL.md"), "# Hack\n");
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const r = new PolicyEngine(makeConfig({ skills: { restricted: ["hack"], requireTriggers: false } })).auditAll().find(x => x.name === "hack");
      expect(r?.violations.some(v => v.code === "SKILL_RESTRICTED")).toBe(true);
    });
    it("skips skill dir without SKILL.md", () => {
      const d = join(tmpDir, ".opencode", "skills", "no-file"); mkdirSync(d, { recursive: true });
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      expect(new PolicyEngine(makeConfig()).auditAll().find(x => x.name === "no-file")).toBeUndefined();
    });
    it("skips non-.md files in agents dir", () => {
      const d = join(tmpDir, ".opencode", "agents"); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "readme.txt"), "not an agent");
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      expect(new PolicyEngine(makeConfig()).auditAll()).toHaveLength(0);
    });
    it("warns skill without triggers when requireTriggers=true", () => {
      const d = join(tmpDir, ".opencode", "skills", "no-triggers"); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "SKILL.md"), "# No Triggers\n");
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
      const r = new PolicyEngine(makeConfig({ skills: { restricted: [], requireTriggers: true } })).auditAll().find(x => x.name === "no-triggers");
      expect(r?.violations.some(v => v.code === "SKILL_NO_TRIGGERS")).toBe(true);
    });

  it("warns AGENT_NO_DESCRIPTION in auditAll when requireDescription=true", () => {
    const d = join(tmpDir, ".opencode", "agents"); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "no-desc.md"), "mode: subagent\n");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const engine = new PolicyEngine(makeConfig({ agents: { allowedModes: ["subagent"], allowPrimaryCreation: false, requireDescription: true, maxSteps: 0 } }));
    const r = engine.auditAll().find(x => x.name === "no-desc");
    expect(r?.violations.some(v => v.code === "AGENT_NO_DESCRIPTION")).toBe(true);
  });

  it("warns AGENT_TOOL_NOT_ALLOWED in auditAll when tool not in non-empty allowlist", () => {
    const d = join(tmpDir, ".opencode", "agents"); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "bad-tool.md"), "mode: subagent\n  bash: true\n");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const r = new PolicyEngine(makeConfig({ tools: { allowed: ["read"], denied: [] } })).auditAll().find(x => x.name === "bad-tool");
    expect(r?.violations.some(v => v.code === "AGENT_TOOL_NOT_ALLOWED")).toBe(true);
  });

  it("detects restricted skill referenced in agent file", () => {
    const d = join(tmpDir, ".opencode", "agents"); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "skill-agent.md"), "mode: subagent\nskills:\n  - hack-skill\n");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const r = new PolicyEngine(makeConfig({ skills: { restricted: ["hack-skill"], requireTriggers: false } })).auditAll().find(x => x.name === "skill-agent");
    expect(r?.violations.some(v => v.code === "AGENT_SKILL_RESTRICTED")).toBe(true);
  });

  it("skips hidden dirs in skills folder", () => {
    const d = join(tmpDir, ".opencode", "skills", ".hidden"); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "SKILL.md"), "# Hidden\n");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    expect(new PolicyEngine(makeConfig()).auditAll().find(x => x.name === ".hidden")).toBeUndefined();
  });

  it("auditAll with enabled=false returns empty violations", () => {
    const d1 = join(tmpDir, ".opencode", "agents"); mkdirSync(d1, { recursive: true });
    const d2 = join(tmpDir, ".opencode", "skills", "s"); mkdirSync(d2, { recursive: true });
    writeFileSync(join(d1, "a.md"), "mode: unknown\n  bash: true\n");
    writeFileSync(join(d2, "SKILL.md"), "# S\n");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    const results = new PolicyEngine(makeConfig({ enabled: false })).auditAll();
    results.forEach(r => expect(r.violations).toHaveLength(0));
  });
  });
});