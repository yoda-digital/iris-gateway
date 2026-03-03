import { tool } from "@opencode-ai/plugin";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const IRIS_URL =
  process.env.IRIS_TOOL_SERVER_URL || "http://127.0.0.1:19877";

async function irisPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${IRIS_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return res.json();
}

async function irisGet(path: string): Promise<unknown> {
  const res = await fetch(`${IRIS_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  return res.json();
}

interface PluginManifest {
  tools: Record<string, { description: string; args: Record<string, string> }>;
}

function loadPluginTools(): Record<string, ReturnType<typeof tool>> {
  const manifestPath =
    process.env.IRIS_STATE_DIR
      ? join(process.env.IRIS_STATE_DIR, "plugin-tools.json")
      : join(homedir(), ".iris", "plugin-tools.json");

  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
  } catch {
    return {};
  }

  const tools: Record<string, ReturnType<typeof tool>> = {};
  for (const [name, def] of Object.entries(manifest.tools)) {
    const args: Record<string, ReturnType<typeof tool.schema.string>> = {};
    for (const [argName, zodType] of Object.entries(def.args)) {
      // Map Zod type names to schema types; default to string
      if (zodType === "ZodNumber") {
        args[argName] = tool.schema.number() as never;
      } else if (zodType === "ZodBoolean") {
        args[argName] = tool.schema.boolean() as never;
      } else {
        args[argName] = tool.schema.string();
      }
    }

    tools[`plugin_${name}`] = tool({
      description: def.description,
      args,
      async execute(execArgs) {
        return JSON.stringify(
          await irisPost(`/tool/plugin/${name}`, execArgs),
        );
      },
    });
  }
  return tools;
}

interface CliToolManifest {
  [toolName: string]: {
    description: string;
    actions: Record<string, {
      positional?: string[];
      flags?: string[];
    }>;
  };
}

function loadCliTools(): Record<string, ReturnType<typeof tool>> {
  const manifestPath =
    process.env.IRIS_STATE_DIR
      ? join(process.env.IRIS_STATE_DIR, "cli-tools.json")
      : join(homedir(), ".iris", "cli-tools.json");

  let manifest: CliToolManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as CliToolManifest;
  } catch {
    return {};
  }

  const tools: Record<string, ReturnType<typeof tool>> = {};
  for (const [name, def] of Object.entries(manifest)) {
    // Build action enum description
    const actionDocs = Object.entries(def.actions)
      .map(([action, actionDef]) => {
        const parts = [action];
        if (actionDef.positional?.length) parts.push(`(args: ${actionDef.positional.join(", ")})`);
        if (actionDef.flags?.length) parts.push(`[flags: ${actionDef.flags.join(", ")}]`);
        return `  - ${parts.join(" ")}`;
      })
      .join("\n");

    const actionNames = Object.keys(def.actions);

    // Collect all possible arg names across all actions
    const allArgs = new Set<string>();
    for (const actionDef of Object.values(def.actions)) {
      if (actionDef.positional) actionDef.positional.forEach((a) => allArgs.add(a));
      if (actionDef.flags) actionDef.flags.forEach((a) => allArgs.add(a));
    }

    const toolArgs: Record<string, ReturnType<typeof tool.schema.string>> = {
      action: tool.schema
        .string()
        .describe(`Action to perform. One of: ${actionNames.join(", ")}`),
    };

    for (const argName of allArgs) {
      toolArgs[argName] = tool.schema
        .string()
        .optional()
        .describe(`Argument for CLI tool (used by actions that need it)`);
    }

    tools[name] = tool({
      description: `${def.description}\n\nAvailable actions:\n${actionDocs}`,
      args: toolArgs,
      async execute(execArgs) {
        return JSON.stringify(
          await irisPost(`/cli/${name}`, execArgs),
        );
      },
    });
  }
  return tools;
}

