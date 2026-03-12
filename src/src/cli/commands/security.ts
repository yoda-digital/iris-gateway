import { Command, Option } from "clipanion";
import { getStateDir } from "../../config/paths.js";
import { AllowlistStore } from "../../security/allowlist-store.js";

export class SecurityAllowlistListCommand extends Command {
  static override paths = [["security", "allowlist", "list"]];

  static override usage = Command.Usage({
    description: "Show the allowlist for a specific channel",
    examples: [
      ["List telegram allowlist", "iris security allowlist list telegram"],
    ],
  });

  channel = Option.String({ name: "channel", required: true });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const store = new AllowlistStore(stateDir);

    const entries = await store.list(this.channel);

    if (entries.length === 0) {
      this.context.stdout.write(
        `No allowlist entries for channel: ${this.channel}\n`,
      );
      return;
    }

    this.context.stdout.write(
      `Allowlist for ${this.channel} (${entries.length}):\n`,
    );
    for (const entry of entries) {
      const approvedAt = new Date(entry.approvedAt).toISOString();
      const approvedBy = entry.approvedBy ?? "unknown";
      this.context.stdout.write(
        `  ${entry.senderId}  approved-by=${approvedBy}  at=${approvedAt}\n`,
      );
    }
  }
}

export class SecurityAllowlistAddCommand extends Command {
  static override paths = [["security", "allowlist", "add"]];

  static override usage = Command.Usage({
    description: "Add a sender to the allowlist for a channel",
    examples: [
      [
        "Allow a telegram user",
        "iris security allowlist add telegram 123456789",
      ],
    ],
  });

  channel = Option.String({ name: "channel", required: true });
  senderId = Option.String({ name: "senderId", required: true });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const store = new AllowlistStore(stateDir);

    await store.add(this.channel, this.senderId, "cli");

    this.context.stdout.write(
      `Added ${this.senderId} to allowlist for channel ${this.channel}\n`,
    );
  }
}
