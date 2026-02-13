import { Command, Option } from "clipanion";
import { loadConfig } from "../../config/loader.js";
import { getStateDir, ensureDir } from "../../config/paths.js";
import { ChannelRegistry } from "../../channels/registry.js";
import { TelegramAdapter } from "../../channels/telegram/index.js";
import { WhatsAppAdapter } from "../../channels/whatsapp/index.js";
import { DiscordAdapter } from "../../channels/discord/index.js";
import { SlackAdapter } from "../../channels/slack/index.js";
import type { ChannelAdapter } from "../../channels/adapter.js";

const ADAPTER_FACTORIES: Record<string, () => ChannelAdapter> = {
  telegram: () => new TelegramAdapter(),
  whatsapp: () => new WhatsAppAdapter(),
  discord: () => new DiscordAdapter(),
  slack: () => new SlackAdapter(),
};

export class SendCommand extends Command {
  static override paths = [["send"]];

  static override usage = Command.Usage({
    description:
      "Send a one-shot message to a channel target (for testing/automation)",
    examples: [
      [
        "Send a message via telegram",
        'iris send telegram 123456789 "Hello from Iris"',
      ],
    ],
  });

  channel = Option.String({ name: "channel", required: true });
  target = Option.String({ name: "target", required: true });
  message = Option.String({ name: "message", required: true });

  async execute(): Promise<void> {
    const config = loadConfig();
    ensureDir(getStateDir());

    const channelConfig = config.channels[this.channel];
    if (!channelConfig) {
      this.context.stdout.write(
        `Unknown channel: ${this.channel}\n` +
          `Available channels: ${Object.keys(config.channels).join(", ") || "(none)"}\n`,
      );
      process.exitCode = 1;
      return;
    }

    const factory = ADAPTER_FACTORIES[channelConfig.type];
    if (!factory) {
      this.context.stdout.write(
        `Unsupported channel type: ${channelConfig.type}\n`,
      );
      process.exitCode = 1;
      return;
    }

    const abortController = new AbortController();
    const adapter = factory();

    try {
      await adapter.start(channelConfig, abortController.signal);
      const result = await adapter.sendText({
        to: this.target,
        text: this.message,
      });
      this.context.stdout.write(
        `Message sent. ID: ${result.messageId}\n`,
      );
    } catch (err) {
      this.context.stdout.write(
        `Failed to send message: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
    } finally {
      abortController.abort();
      await adapter.stop();
    }
  }
}
