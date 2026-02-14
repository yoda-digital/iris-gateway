import type { CliToolDef, CliToolManifest } from "./types.js";

export interface BuiltCommand {
  binary: string;
  args: string[];
}

export class CliToolRegistry {
  private readonly tools: Record<string, CliToolDef>;

  constructor(tools: Record<string, CliToolDef>) {
    this.tools = tools;
  }

  buildCommand(
    toolName: string,
    action: string,
    args: Record<string, string>,
  ): BuiltCommand {
    const toolDef = this.tools[toolName];
    if (!toolDef) {
      throw new Error(`Unknown CLI tool: ${toolName}`);
    }

    const actionDef = toolDef.actions[action];
    if (!actionDef) {
      throw new Error(
        `Unknown action '${action}' for tool '${toolName}'`,
      );
    }

    const cmdArgs: string[] = [...actionDef.subcommand];

    // Add positional args in order
    if (actionDef.positional) {
      for (const name of actionDef.positional) {
        if (args[name] != null) {
          cmdArgs.push(args[name]);
        }
      }
    }

    // Add declared flags
    if (actionDef.flags) {
      for (const flag of actionDef.flags) {
        if (args[flag] != null) {
          cmdArgs.push(`--${flag}=${args[flag]}`);
        }
      }
    }

    // Always append --json --no-input
    cmdArgs.push("--json", "--no-input");

    return { binary: toolDef.binary, args: cmdArgs };
  }

  listTools(): string[] {
    return Object.keys(this.tools);
  }

  getToolDef(toolName: string): CliToolDef | undefined {
    return this.tools[toolName];
  }

  getManifest(): CliToolManifest {
    const manifest: CliToolManifest = {};
    for (const [name, def] of Object.entries(this.tools)) {
      manifest[name] = {
        description: def.description,
        actions: {},
      };
      for (const [actionName, actionDef] of Object.entries(def.actions)) {
        manifest[name].actions[actionName] = {
          positional: actionDef.positional,
          flags: actionDef.flags,
        };
      }
    }
    return manifest;
  }
}
