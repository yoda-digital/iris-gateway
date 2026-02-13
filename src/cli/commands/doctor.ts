import { Command } from "clipanion";
import { loadConfig } from "../../config/loader.js";
import { getConfigPath, getStateDir } from "../../config/paths.js";
import { accessSync, constants, mkdirSync } from "node:fs";

export class DoctorCommand extends Command {
  static override paths = [["doctor"]];

  static override usage = Command.Usage({
    description:
      "Run diagnostic checks on the Iris gateway configuration and environment",
    examples: [["Run diagnostics", "iris doctor"]],
  });

  async execute(): Promise<void> {
    this.context.stdout.write("Iris Doctor\n");
    this.context.stdout.write("===========\n\n");

    let allPassed = true;

    // Check 1: Config valid
    const configPath = getConfigPath();
    try {
      loadConfig();
      this.context.stdout.write(`[PASS] Config valid (${configPath})\n`);
    } catch (err) {
      this.context.stdout.write(
        `[FAIL] Config invalid (${configPath}): ${err instanceof Error ? err.message : String(err)}\n`,
      );
      allPassed = false;
    }

    // Check 2: State dir exists and writable
    const stateDir = getStateDir();
    try {
      mkdirSync(stateDir, { recursive: true });
      accessSync(stateDir, constants.W_OK);
      this.context.stdout.write(`[PASS] State dir writable (${stateDir})\n`);
    } catch (err) {
      this.context.stdout.write(
        `[FAIL] State dir not writable (${stateDir}): ${err instanceof Error ? err.message : String(err)}\n`,
      );
      allPassed = false;
    }

    // Check 3: OpenCode reachable
    let config;
    try {
      config = loadConfig();
    } catch {
      // Already reported above
      config = null;
    }

    if (config) {
      const openCodeUrl = `http://${config.opencode.hostname}:${config.opencode.port}`;
      try {
        const res = await fetch(`${openCodeUrl}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          this.context.stdout.write(
            `[PASS] OpenCode reachable (${openCodeUrl})\n`,
          );
        } else {
          this.context.stdout.write(
            `[FAIL] OpenCode returned status ${res.status} (${openCodeUrl})\n`,
          );
          allPassed = false;
        }
      } catch {
        this.context.stdout.write(
          `[FAIL] OpenCode not reachable (${openCodeUrl})\n`,
        );
        allPassed = false;
      }

      // Check 4: Channels configured
      const channelEntries = Object.entries(config.channels);
      const enabledChannels = channelEntries.filter(
        ([, ch]) => ch.enabled,
      );

      if (enabledChannels.length > 0) {
        this.context.stdout.write(
          `[PASS] Channels configured (${enabledChannels.length} enabled: ${enabledChannels.map(([id]) => id).join(", ")})\n`,
        );
      } else if (channelEntries.length > 0) {
        this.context.stdout.write(
          `[FAIL] No enabled channels (${channelEntries.length} configured but all disabled)\n`,
        );
        allPassed = false;
      } else {
        this.context.stdout.write(`[FAIL] No channels configured\n`);
        allPassed = false;
      }
    }

    this.context.stdout.write("\n");
    if (allPassed) {
      this.context.stdout.write("All checks passed.\n");
    } else {
      this.context.stdout.write("Some checks failed.\n");
      process.exitCode = 1;
    }
  }
}
