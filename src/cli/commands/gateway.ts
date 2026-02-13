import { Command, Option } from "clipanion";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = require("../../../package.json") as { version: string };
import { startGateway } from "../../gateway/lifecycle.js";
import { printBanner } from "../banner.js";

export class GatewayRunCommand extends Command {
  static override paths = [["gateway", "run"], Command.Default];

  static override usage = Command.Usage({
    description: "Start the Iris messaging gateway",
    examples: [
      ["Start with default config", "iris gateway run"],
      ["Start with custom config", "iris gateway run --config ./my-config.json"],
    ],
  });

  config = Option.String("--config,-c", {
    description: "Path to config file",
    required: false,
  });

  async execute(): Promise<void> {
    printBanner(pkg.version);

    try {
      const _ctx = await startGateway(this.config);
      // Gateway is running, wait for shutdown signal
      await new Promise(() => {}); // Block forever until signal
    } catch (err) {
      console.error("Failed to start gateway:", err);
      process.exit(1);
    }
  }
}
