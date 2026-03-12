import { Command, Option } from "clipanion";
import { getStateDir } from "../../config/paths.js";
import { SessionMap } from "../../bridge/session-map.js";

export class SessionListCommand extends Command {
  static override paths = [["session", "list"]];

  static override usage = Command.Usage({
    description: "List all session mappings",
    examples: [["List sessions", "iris session list"]],
  });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const sessionMap = new SessionMap(stateDir);

    const entries = await sessionMap.list();

    if (entries.length === 0) {
      this.context.stdout.write("No active sessions.\n");
      return;
    }

    this.context.stdout.write(`Active sessions (${entries.length}):\n`);
    for (const entry of entries) {
      const key = `${entry.channelId}:${entry.chatType}:${entry.chatId}`;
      const lastActive = new Date(entry.lastActiveAt).toISOString();
      this.context.stdout.write(
        `  ${key}\n` +
          `    opencode-session: ${entry.openCodeSessionId}\n` +
          `    sender: ${entry.senderId}\n` +
          `    last active: ${lastActive}\n`,
      );
    }
  }
}

export class SessionResetCommand extends Command {
  static override paths = [["session", "reset"]];

  static override usage = Command.Usage({
    description: "Reset a specific session mapping",
    examples: [
      [
        "Reset a session by key",
        "iris session reset telegram:dm:123456",
      ],
    ],
  });

  key = Option.String({ name: "key", required: true });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const sessionMap = new SessionMap(stateDir);

    await sessionMap.reset(this.key);
    this.context.stdout.write(`Session reset: ${this.key}\n`);
  }
}
