import { Command, Option } from "clipanion";
import { getStateDir } from "../../config/paths.js";
import { CronStore } from "../../cron/store.js";

export class CronListCommand extends Command {
  static override paths = [["cron", "list"]];

  static override usage = Command.Usage({
    description: "List scheduled cron jobs",
    examples: [["List all cron jobs", "iris cron list"]],
  });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const store = new CronStore(stateDir);

    const jobs = await store.list();

    if (jobs.length === 0) {
      this.context.stdout.write("No cron jobs configured.\n");
      return;
    }

    this.context.stdout.write(`Cron jobs (${jobs.length}):\n`);
    for (const job of jobs) {
      const status = job.enabled ? "enabled" : "disabled";
      this.context.stdout.write(
        `  ${job.name}  [${status}]\n` +
          `    schedule: ${job.schedule}\n` +
          `    channel:  ${job.channel}\n` +
          `    chatId:   ${job.chatId}\n` +
          `    prompt:   ${job.prompt}\n`,
      );
    }
  }
}

export class CronAddCommand extends Command {
  static override paths = [["cron", "add"]];

  static override usage = Command.Usage({
    description: "Add a new cron job",
    examples: [
      [
        "Add a daily reminder",
        'iris cron add daily-report "0 9 * * *" "Generate daily status report" --channel telegram --chat-id 123',
      ],
    ],
  });

  name = Option.String({ name: "name", required: true });
  schedule = Option.String({ name: "schedule", required: true });
  prompt = Option.String({ name: "prompt", required: true });

  channel = Option.String("--channel", {
    description: "Channel to send cron output to",
    required: true,
  });

  chatId = Option.String("--chat-id", {
    description: "Chat ID to send cron output to",
    required: true,
  });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const store = new CronStore(stateDir);

    await store.add({
      name: this.name,
      schedule: this.schedule,
      prompt: this.prompt,
      channel: this.channel,
      chatId: this.chatId,
      enabled: true,
    });

    this.context.stdout.write(
      `Added cron job: ${this.name}\n` +
        `  schedule: ${this.schedule}\n` +
        `  channel:  ${this.channel}\n` +
        `  chatId:   ${this.chatId}\n`,
    );
  }
}

export class CronRemoveCommand extends Command {
  static override paths = [["cron", "remove"]];

  static override usage = Command.Usage({
    description: "Remove a cron job",
    examples: [["Remove a cron job", "iris cron remove daily-report"]],
  });

  name = Option.String({ name: "name", required: true });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const store = new CronStore(stateDir);

    const removed = await store.remove(this.name);

    if (removed) {
      this.context.stdout.write(`Removed cron job: ${this.name}\n`);
    } else {
      this.context.stdout.write(`Cron job not found: ${this.name}\n`);
      process.exitCode = 1;
    }
  }
}
