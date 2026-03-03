import { tool } from "@opencode-ai/plugin";
import { irisPost, irisGet } from "../lib.js";

export const skillsTools = {
  skill_create: tool({
      description:
        "Create an OpenCode skill with full Iris integration. Skills get SKILL.md with frontmatter (name, description, metadata.triggers for proactive triggering, metadata.auto for auto-activation). If no content provided, generates Iris-aware template with vault/tool references.",
      args: {
        name: tool.schema
          .string()
          .describe("Skill name (lowercase, dashes, starts with letter)"),
        description: tool.schema
          .string()
          .describe("Brief skill description (REQUIRED)"),
        content: tool.schema
          .string()
          .optional()
          .describe(
            "Skill content (markdown body). If omitted, generates Iris-aware template.",
          ),
        triggers: tool.schema
          .string()
          .optional()
          .describe(
            'Comma-separated trigger keywords for proactive skill suggestion (e.g. "weather,forecast,rain")',
          ),
        auto: tool.schema
          .string()
          .optional()
          .describe(
            'Set to "true" to auto-activate this skill without explicit invocation',
          ),
        metadata: tool.schema
          .object({})
          .passthrough()
          .optional()
          .describe("Additional metadata key-value pairs for the skill"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/skills/create", args));
      },
    }),,

  skill_list: tool({
      description:
        "List all OpenCode skills with details: name, description, trigger keywords, auto-activation status",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/skills/list"));
      },
    }),,

  skill_delete: tool({
      description: "Delete an OpenCode skill by name",
      args: {
        name: tool.schema.string().describe("Skill name to delete"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/skills/delete", args));
      },
    }),,

  skill_validate: tool({
      description:
        "Validate a skill against OpenCode spec and Iris best practices. Returns errors (blocking) and warnings (advisory).",
      args: {
        name: tool.schema.string().describe("Skill name to validate"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/skills/validate", args));
      },
    }),,

  agent_create: tool({
      description:
        "Create an OpenCode agent with full spec compliance and Iris architecture awareness. REQUIRES description. Generates Iris-aware prompt with vault/governance/tool context if no custom prompt provided. Supports all OpenCode frontmatter: mode, model, temperature, top_p, steps, disable, hidden, color, permission block, {file:} includes.",
      args: {
        name: tool.schema
          .string()
          .describe("Agent name (lowercase, dashes, starts with letter)"),
        description: tool.schema
          .string()
          .describe(
            "Agent description (REQUIRED by OpenCode spec — shown in agent list)",
          ),
        prompt: tool.schema
          .string()
          .optional()
          .describe(
            "Custom system prompt. If omitted, generates full Iris-aware prompt with architecture context, tool catalog, vault instructions, and safety rules.",
          ),
        mode: tool.schema
          .enum(["primary", "subagent", "all"])
          .optional()
          .describe("Agent mode (default: subagent)"),
        model: tool.schema.string().optional().describe("Model override (e.g. openrouter/google/gemini-2.0-flash-exp)"),
        temperature: tool.schema
          .number()
          .optional()
          .describe("Temperature 0-2 (default: model default)"),
        top_p: tool.schema
          .number()
          .optional()
          .describe("Top-p sampling 0-1"),
        steps: tool.schema
          .number()
          .optional()
          .describe("Max tool call steps before stopping"),
        tools: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe(
            "Tool names to enable (e.g. ['vault_search','send_message']). skill tool always included.",
          ),
        skills: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe(
            "Skill names to enable (default: all available skills)",
          ),
        disable: tool.schema
          .boolean()
          .optional()
          .describe("Disable this agent (hidden from use but preserved)"),
        hidden: tool.schema
          .boolean()
          .optional()
          .describe("Hide from agent list UI"),
        color: tool.schema
          .string()
          .optional()
          .describe("Agent color in UI (hex or named color)"),
        includes: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe(
            'File paths to include via {file:./path} syntax (OpenCode resolves them at runtime)',
          ),
        permission: tool.schema
          .object({})
          .passthrough()
          .optional()
          .describe(
            "Per-agent permission overrides (e.g. { allow: { bash: 'deny' } })",
          ),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/agents/create", args));
      },
    }),,

  agent_list: tool({
      description:
        "List all OpenCode agents with details: name, mode, description, model, skill/tool counts, disabled/hidden status",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/agents/list"));
      },
    }),,

  agent_delete: tool({
      description: "Delete an OpenCode agent by name",
      args: {
        name: tool.schema.string().describe("Agent name to delete"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/agents/delete", args));
      },
    }),,

  agent_validate: tool({
      description:
        "Validate an agent against OpenCode spec and Iris best practices. Returns errors (blocking) and warnings (advisory).",
      args: {
        name: tool.schema.string().describe("Agent name to validate"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/agents/validate", args));
      },
    }),,

  rules_read: tool({
      description:
        "Read current project behavioral rules (AGENTS.md). These are global instructions that apply to all agents — identity, behavior, tool usage, safety.",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/rules/read"));
      },
    }),,

  rules_update: tool({
      description:
        "Replace the entire AGENTS.md with new content. Use rules_read first to see current content. This controls global agent behavior.",
      args: {
        content: tool.schema
          .string()
          .describe("Full markdown content for AGENTS.md"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/rules/update", args));
      },
    }),,

  rules_append: tool({
      description:
        "Append a new section to AGENTS.md without overwriting existing content. Use for adding new rules incrementally.",
      args: {
        section: tool.schema
          .string()
          .describe(
            "Markdown section to append (e.g. '## New Rule\\nDescription...')",
          ),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/rules/append", args));
      },
    }),,

  tools_list: tool({
      description:
        "List custom tools from .opencode/tools/ directory. These are TypeScript tools that extend OpenCode's capabilities.",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/tools/list"));
      },
    }),,

  tools_create: tool({
      description:
        "Scaffold a new custom OpenCode tool in .opencode/tools/. Creates a TypeScript file with tool() helper, Zod schema, and execute function.",
      args: {
        name: tool.schema
          .string()
          .describe("Tool name (lowercase, dashes)"),
        description: tool.schema
          .string()
          .describe("Tool description (REQUIRED)"),
        args: tool.schema
          .array(
            tool.schema.object({
              name: tool.schema.string(),
              type: tool.schema.enum(["string", "number", "boolean"]),
              description: tool.schema.string(),
              required: tool.schema.boolean().optional(),
            }),
          )
          .optional()
          .describe("Tool argument definitions"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/tools/create", args));
      },
    }),,
} as const;
