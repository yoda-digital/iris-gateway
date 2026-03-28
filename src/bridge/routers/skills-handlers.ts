/**
 * skills-handlers.ts — HTTP handler execution for skills, agents, rules, and tools.
 *
 * @decomposition-plan (issue #235 — VISION.md §1 pre-emption at 358 lines)
 * Registration/catalog/context logic moved to skills-context.ts:
 *   - skills-context.ts → SkillsDeps, HandlerDirs, IRIS_TOOL_CATALOG, buildHandlerDirs, buildIrisContext
 *   - skills-handlers.ts → handler functions (this file, ~240 lines)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "hono";
import { buildIrisContext } from "./skills-context.js";
import type { HandlerDirs, SkillsDeps } from "./skills-context.js";

export type { SkillsDeps, HandlerDirs };
export { buildHandlerDirs, buildIrisContext, IRIS_TOOL_CATALOG } from "./skills-context.js";

// ── Skills ──

export async function handleSkillCreate(c: Context, deps: SkillsDeps, dirs: HandlerDirs) {
  const body = await c.req.json();
  const name = body.name as string;
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name))
    return c.json({ error: "Invalid skill name (lowercase, dashes, starts with letter)" }, 400);
  if (!body.description?.trim()) return c.json({ error: "description is required" }, 400);
  if (deps.policyEngine?.enabled) {
    const violations = deps.policyEngine.validateSkillCreation({ name, triggers: body.triggers });
    const errors = violations.filter((v) => v.level === "error");
    if (errors.length > 0)
      return c.json({ error: "Policy violation", violations: errors.map((v) => `[${v.code}] ${v.message}`) }, 403);
  }
  const dir = join(dirs.skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const fm: string[] = ["---", `name: ${name}`, `description: ${body.description}`];
  const meta: Record<string, string> = {};
  if (body.triggers) meta.triggers = body.triggers as string;
  if (body.auto) meta.auto = body.auto as string;
  if (body.metadata && typeof body.metadata === "object")
    for (const [k, v] of Object.entries(body.metadata as Record<string, string>)) meta[k] = v;
  if (Object.keys(meta).length > 0) { fm.push("metadata:"); for (const [k, v] of Object.entries(meta)) fm.push(`  ${k}: "${v}"`); }
  fm.push("---");
  const content = body.content?.trim() ? (body.content as string) : [
    `When the ${name} skill is invoked:\n`,
    "1. Check vault for relevant user context: `vault_search` with sender ID",
    "2. [Implement your skill logic here]",
    "3. Store any discovered facts with `vault_remember` if appropriate",
    "4. Keep responses under 2000 characters (messaging platform limit)",
    "5. Use plain text, not markdown",
    "", "## Available Tools",
    "- vault_search, vault_remember, vault_forget — persistent memory",
    "- send_message, send_media — channel communication",
    "- governance_status — check current rules",
  ].join("\n");
  writeFileSync(join(dir, "SKILL.md"), `${fm.join("\n")}\n\n${content}\n`);
  return c.json({ ok: true, path: join(dir, "SKILL.md") });
}

export function handleSkillList(c: Context, dirs: HandlerDirs) {
  if (!existsSync(dirs.skillsDir)) return c.json({ skills: [] });
  const skills: Array<{ name: string; path: string; description: string; triggers: string | null; auto: boolean }> = [];
  for (const entry of readdirSync(dirs.skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillFile = join(dirs.skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const raw = readFileSync(skillFile, "utf-8");
    skills.push({ name: entry.name, path: skillFile, description: raw.match(/description:\s*(.+)/)?.[1]?.trim() ?? "", triggers: raw.match(/triggers:\s*"([^"]+)"/)?.[1] ?? null, auto: raw.match(/auto:\s*"([^"]+)"/)?.[1] === "true" });
  }
  return c.json({ skills });
}

export async function handleSkillDelete(c: Context, dirs: HandlerDirs) {
  const body = await c.req.json();
  const name = body.name as string;
  if (!name) return c.json({ error: "name required" }, 400);
  const dir = join(dirs.skillsDir, name);
  if (!existsSync(dir)) return c.json({ error: "Skill not found" }, 404);
  rmSync(dir, { recursive: true, force: true });
  return c.json({ ok: true });
}

export async function handleSkillValidate(c: Context, dirs: HandlerDirs) {
  const body = await c.req.json();
  const name = body.name as string;
  if (!name) return c.json({ valid: false, errors: ["name required"], warnings: [] });
  const skillFile = join(dirs.skillsDir, name, "SKILL.md");
  if (!existsSync(skillFile)) return c.json({ valid: false, errors: ["SKILL.md not found"], warnings: [] });
  const raw = readFileSync(skillFile, "utf-8");
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!(raw.startsWith("---") && raw.indexOf("---", 3) > 3)) errors.push("Missing YAML frontmatter");
  if (!/name:\s*.+/.test(raw)) errors.push("Missing 'name' in frontmatter");
  if (!/description:\s*.+/.test(raw)) errors.push("Missing 'description' in frontmatter");
  if (!/triggers:/.test(raw)) warnings.push("No 'metadata.triggers' — skill won't participate in proactive triggering");
  if (!/vault/.test(raw)) warnings.push("No vault tool references — consider using vault for user context");
  const fmEnd = raw.indexOf("---", 3);
  if (fmEnd > 0) {
    const contentBody = raw.substring(fmEnd + 3).trim();
    if (!contentBody) warnings.push("Empty skill body — no instructions for the AI");
    if (contentBody.length < 30) warnings.push("Very short skill body — consider adding step-by-step instructions");
  }
  return c.json({ valid: errors.length === 0, errors, warnings });
}

export async function handleSkillSuggest(c: Context, dirs: HandlerDirs) {
  const body = await c.req.json();
  const text = ((body.text as string) ?? "").toLowerCase();
  if (!text || !existsSync(dirs.skillsDir)) return c.json({ suggestions: [] });
  const suggestions: Array<{ name: string; description: string }> = [];
  for (const entry of readdirSync(dirs.skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillFile = join(dirs.skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const raw = readFileSync(skillFile, "utf-8");
    const triggerMatch = raw.match(/triggers:\s*"([^"]+)"/);
    if (!triggerMatch) continue;
    const triggers = triggerMatch[1].split(",").map((t) => t.trim().toLowerCase());
    if (triggers.some((trigger) => text.includes(trigger)))
      suggestions.push({ name: entry.name, description: raw.match(/description:\s*(.+)/)?.[1]?.trim() ?? "" });
  }
  return c.json({ suggestions });
}

// ── Agents ──

export async function handleAgentCreate(c: Context, deps: SkillsDeps, dirs: HandlerDirs) {
  const body = await c.req.json();
  const name = body.name as string;
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name))
    return c.json({ error: "Invalid agent name (lowercase, dashes, starts with letter)" }, 400);
  const description = body.description as string | undefined;
  if (!description?.trim()) return c.json({ error: "description is required (OpenCode spec)" }, 400);
  if (deps.policyEngine?.enabled) {
    const violations = deps.policyEngine.validateAgentCreation({ name, mode: body.mode, tools: body.tools, skills: body.skills, steps: body.steps, description, permission: body.permission });
    const errors = violations.filter((v) => v.level === "error");
    if (errors.length > 0)
      return c.json({ error: "Policy violation", violations: errors.map((v) => `[${v.code}] ${v.message}`) }, 403);
  }
  mkdirSync(dirs.agentsDir, { recursive: true });
  const toolEntries: string[] = [];
  if (body.tools?.length) for (const t of body.tools as string[]) toolEntries.push(`  ${t}: true`);
  if (!toolEntries.some((t) => t.includes("skill:"))) toolEntries.push("  skill: true");
  if (deps.policyEngine?.enabled)
    for (const dt of deps.policyEngine.getConfig().agents.defaultTools)
      if (!toolEntries.some((t) => t.includes(`${dt}:`))) toolEntries.push(`  ${dt}: true`);
  const skillNames: string[] = body.skills ?? [];
  if (skillNames.length === 0) {
    try { for (const entry of readdirSync(dirs.skillsDir, { withFileTypes: true })) if (entry.isDirectory() && !entry.name.startsWith(".")) skillNames.push(entry.name); } catch { /* no skills dir */ }
  }
  const fm: string[] = ["---", `description: ${description}`, `mode: ${body.mode ?? "subagent"}`];
  if (body.model) fm.push(`model: ${body.model}`);
  if (body.temperature != null) fm.push(`temperature: ${body.temperature}`);
  if (body.top_p != null) fm.push(`top_p: ${body.top_p}`);
  if (body.steps != null) fm.push(`steps: ${body.steps}`);
  if (body.disable === true) fm.push("disable: true");
  if (body.hidden === true) fm.push("hidden: true");
  if (body.color) fm.push(`color: ${body.color}`);
  if (toolEntries.length > 0) fm.push(`tools:\n${toolEntries.join("\n")}`);
  if (skillNames.length > 0) fm.push(`skills:\n${skillNames.map((s) => `  - ${s}`).join("\n")}`);
  if (body.permission) {
    const perm = body.permission as Record<string, unknown>;
    const permLines: string[] = ["permission:"];
    for (const [key, val] of Object.entries(perm)) {
      if (typeof val === "object" && val !== null) { permLines.push(`  ${key}:`); for (const [k, v] of Object.entries(val as Record<string, unknown>)) permLines.push(`    ${k}: ${v}`); }
      else permLines.push(`  ${key}: ${val}`);
    }
    fm.push(permLines.join("\n"));
  }
  fm.push("---");
  let prompt = body.prompt ? (body.prompt as string) : buildIrisContext(name, description, dirs.skillsDir, dirs.irisToolCatalog);
  if (body.includes?.length) prompt = `${prompt}\n\n${(body.includes as string[]).map((p) => `{file:${p}}`).join("\n")}`;
  writeFileSync(join(dirs.agentsDir, `${name}.md`), `${fm.join("\n")}\n\n${prompt}\n`);
  return c.json({ ok: true, path: join(dirs.agentsDir, `${name}.md`) });
}

export function handleAgentList(c: Context, dirs: HandlerDirs) {
  if (!existsSync(dirs.agentsDir)) return c.json({ agents: [] });
  const agents: Array<{ name: string; path: string; mode: string; description: string; model?: string; disabled: boolean; hidden: boolean; skillCount: number; toolCount: number }> = [];
  for (const entry of readdirSync(dirs.agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const agentPath = join(dirs.agentsDir, entry.name);
    const raw = readFileSync(agentPath, "utf-8");
    agents.push({ name: entry.name.replace(/\.md$/, ""), path: agentPath, mode: raw.match(/mode:\s*(\w+)/)?.[1] ?? "unknown", description: raw.match(/description:\s*(.+)/)?.[1]?.trim() ?? "", model: raw.match(/model:\s*(.+)/)?.[1]?.trim(), disabled: /disable:\s*true/.test(raw), hidden: /hidden:\s*true/.test(raw), skillCount: raw.match(/^\s*- (\S+)/gm)?.length ?? 0, toolCount: raw.match(/^\s+(\w+):\s*true/gm)?.length ?? 0 });
  }
  return c.json({ agents });
}

export async function handleAgentDelete(c: Context, dirs: HandlerDirs) {
  const body = await c.req.json();
  const name = body.name as string;
  if (!name) return c.json({ error: "name required" }, 400);
  const agentFile = join(dirs.agentsDir, `${name}.md`);
  if (!existsSync(agentFile)) return c.json({ error: "Agent not found" }, 404);
  rmSync(agentFile);
  return c.json({ ok: true });
}

export async function handleAgentValidate(c: Context, dirs: HandlerDirs) {
  const body = await c.req.json();
  const name = body.name as string;
  if (!name) return c.json({ valid: false, errors: ["name required"], warnings: [] });
  const agentFile = join(dirs.agentsDir, `${name}.md`);
  if (!existsSync(agentFile)) return c.json({ valid: false, errors: ["Agent file not found"], warnings: [] });
  const raw = readFileSync(agentFile, "utf-8");
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!(raw.startsWith("---") && raw.indexOf("---", 3) > 3)) errors.push("Missing YAML frontmatter");
  if (!/description:\s*.+/.test(raw)) errors.push("Missing 'description' (REQUIRED by OpenCode)");
  if (!/mode:\s*\w+/.test(raw)) errors.push("Missing 'mode' in frontmatter");
  if (!/skill:\s*true/.test(raw)) warnings.push("No 'skill: true' in tools — agent cannot use skills");
  if (!/skills:/.test(raw)) warnings.push("No 'skills' list — agent has no skills configured");
  if (!/vault/.test(raw)) warnings.push("No vault tools — agent has no persistent memory access");
  const fmEnd = raw.indexOf("---", 3);
  if (fmEnd > 0) {
    const bodyText = raw.substring(fmEnd + 3).trim();
    if (!bodyText) warnings.push("Empty prompt body — agent has no instructions");
    if (bodyText.length < 50) warnings.push("Very short prompt body — consider adding Iris architecture context");
  }
  return c.json({ valid: errors.length === 0, errors, warnings });
}

// ── Rules ──

export function handleRulesRead(c: Context, dirs: HandlerDirs) {
  if (!existsSync(dirs.rulesFile)) return c.json({ content: null, exists: false });
  return c.json({ content: readFileSync(dirs.rulesFile, "utf-8"), exists: true });
}

export async function handleRulesUpdate(c: Context, dirs: HandlerDirs) {
  const body = await c.req.json();
  const content = body.content as string;
  if (typeof content !== "string") return c.json({ error: "content (string) is required" }, 400);
  writeFileSync(dirs.rulesFile, content);
  return c.json({ ok: true, path: dirs.rulesFile });
}

export async function handleRulesAppend(c: Context, dirs: HandlerDirs) {
  const body = await c.req.json();
  const section = body.section as string;
  if (!section?.trim()) return c.json({ error: "section (string) is required" }, 400);
  const existing = existsSync(dirs.rulesFile) ? readFileSync(dirs.rulesFile, "utf-8") : "";
  const separator = !existing ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(dirs.rulesFile, `${existing}${separator}${section}\n`);
  return c.json({ ok: true, path: dirs.rulesFile });
}

// ── Custom Tools ──

export function handleToolsList(c: Context, dirs: HandlerDirs) {
  if (!existsSync(dirs.customToolsDir)) return c.json({ tools: [], dir: dirs.customToolsDir });
  const tools: Array<{ name: string; path: string; type: string }> = [];
  for (const entry of readdirSync(dirs.customToolsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = entry.name.split(".").pop() ?? "";
    if (!["ts", "js", "mjs"].includes(ext)) continue;
    tools.push({ name: entry.name.replace(/\.\w+$/, ""), path: join(dirs.customToolsDir, entry.name), type: ext });
  }
  return c.json({ tools, dir: dirs.customToolsDir });
}

export async function handleToolsCreate(c: Context, dirs: HandlerDirs) {
  const body = await c.req.json();
  const name = body.name as string;
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name))
    return c.json({ error: "Invalid tool name (lowercase, dashes, starts with letter)" }, 400);
  if (!body.description?.trim()) return c.json({ error: "description is required" }, 400);
  mkdirSync(dirs.customToolsDir, { recursive: true });
  const args = (body.args ?? []) as Array<{ name: string; type: string; description: string; required?: boolean }>;
  const argLines = args.map((a) => {
    const schemaType = a.type === "number" ? "z.number()" : a.type === "boolean" ? "z.boolean()" : "z.string()";
    return `    ${a.name}: ${a.required === false ? `${schemaType}.optional()` : schemaType}.describe("${a.description}"),`;
  });
  const content = [`import { z } from "zod";`, `import { tool } from "@opencode-ai/core";`, ``, `export default tool({`, `  name: "${name}",`, `  description: "${body.description}",`, `  parameters: z.object({`, ...argLines, `  }),`, `  async execute(_args) {`, `    throw new Error(\`Tool '${name}' was scaffolded but not implemented. Edit ${name}.ts to add logic.\`);`, `  },`, `});`, ``].join("\n");
  const toolPath = join(dirs.customToolsDir, `${name}.ts`);
  writeFileSync(toolPath, content);
  return c.json({ ok: true, path: toolPath });
}
