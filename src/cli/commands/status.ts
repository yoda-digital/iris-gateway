import { Command } from "clipanion";
import { loadConfig } from "../../config/loader.js";
import { getConfigPath, getStateDir } from "../../config/paths.js";

export class StatusCommand extends Command {
  static override paths = [["status"]];

  static override usage = Command.Usage({
    description: "Show gateway status and diagnostics",
    examples: [["Show status", "iris status"]],
  });

  async execute(): Promise<void> {
    const configPath = getConfigPath();
    const stateDir = getStateDir();

    let config;
    try {
      config = loadConfig();
    } catch (err) {
      this.context.stdout.write(`Config: INVALID (${configPath})\n`);
      this.context.stdout.write(
        `  Error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
      return;
    }

    this.context.stdout.write(`Iris Gateway Status\n`);
    this.context.stdout.write(`-------------------\n`);
    this.context.stdout.write(`Config path: ${configPath}\n`);
    this.context.stdout.write(`State dir:   ${stateDir}\n`);
    this.context.stdout.write(`Gateway:     ${config.gateway.hostname}:${config.gateway.port}\n`);
    this.context.stdout.write(
      `OpenCode:    ${config.opencode.hostname}:${config.opencode.port}\n`,
    );

    const channelEntries = Object.entries(config.channels);
    if (channelEntries.length === 0) {
      this.context.stdout.write(`Channels:    (none configured)\n`);
    } else {
      this.context.stdout.write(`Channels:\n`);
      for (const [id, ch] of channelEntries) {
        const status = ch.enabled ? "enabled" : "disabled";
        this.context.stdout.write(`  ${id}: ${ch.type} (${status})\n`);
      }
    }

    this.context.stdout.write(
      `Security:    dm-policy=${config.security.defaultDmPolicy}\n`,
    );
  }
}
