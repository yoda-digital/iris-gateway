import { Command, Option } from "clipanion";
import { loadConfig } from "../../config/loader.js";
import { getConfigPath } from "../../config/paths.js";
import { parseConfig } from "../../config/schema.js";
import { readFileSync } from "node:fs";
import { substituteEnv } from "../../config/loader.js";

export class ConfigShowCommand extends Command {
  static override paths = [["config", "show"]];

  static override usage = Command.Usage({
    description: "Show current configuration (tokens redacted)",
    examples: [["Show config", "iris config show"]],
  });

  async execute(): Promise<void> {
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      this.context.stdout.write(
        `Failed to load config: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
      return;
    }

    // Deep clone and redact sensitive fields
    const redacted = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    const channels = redacted["channels"] as
      | Record<string, Record<string, unknown>>
      | undefined;

    if (channels) {
      for (const ch of Object.values(channels)) {
        if (ch["token"]) ch["token"] = "***REDACTED***";
        if (ch["appToken"]) ch["appToken"] = "***REDACTED***";
        if (ch["botToken"]) ch["botToken"] = "***REDACTED***";
      }
    }

    this.context.stdout.write(JSON.stringify(redacted, null, 2) + "\n");
  }
}

export class ConfigValidateCommand extends Command {
  static override paths = [["config", "validate"]];

  static override usage = Command.Usage({
    description: "Validate a configuration file",
    examples: [
      ["Validate default config", "iris config validate"],
      ["Validate specific file", "iris config validate ./my-config.json"],
    ],
  });

  configFile = Option.String({ name: "path", required: false });

  async execute(): Promise<void> {
    const configPath = this.configFile ?? getConfigPath();

    let content: string;
    try {
      content = readFileSync(configPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.context.stdout.write(`Config file not found: ${configPath}\n`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    try {
      const substituted = substituteEnv(content);
      const raw = JSON.parse(substituted) as unknown;
      parseConfig(raw);
      this.context.stdout.write(`Config is valid: ${configPath}\n`);
    } catch (err) {
      this.context.stdout.write(
        `Config is INVALID: ${configPath}\n` +
          `  ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
