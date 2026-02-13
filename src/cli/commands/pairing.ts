import { Command, Option } from "clipanion";
import { getStateDir } from "../../config/paths.js";
import { PairingStore } from "../../security/pairing-store.js";
import { AllowlistStore } from "../../security/allowlist-store.js";

export class PairingApproveCommand extends Command {
  static override paths = [["pairing", "approve"]];

  static override usage = Command.Usage({
    description: "Approve a pairing code and add the sender to the allowlist",
    examples: [["Approve a pairing code", "iris pairing approve ABCD1234"]],
  });

  code = Option.String({ name: "code", required: true });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const pairingStore = new PairingStore(stateDir);
    const allowlistStore = new AllowlistStore(stateDir);

    const result = await pairingStore.approveCode(this.code);

    if (!result) {
      this.context.stdout.write(
        `No pending pairing request found for code: ${this.code}\n`,
      );
      process.exitCode = 1;
      return;
    }

    await allowlistStore.add(result.channelId, result.senderId, "cli");

    this.context.stdout.write(
      `Approved pairing code ${this.code}\n` +
        `  Channel: ${result.channelId}\n` +
        `  Sender:  ${result.senderId}\n` +
        `Added to allowlist.\n`,
    );
  }
}

export class PairingListCommand extends Command {
  static override paths = [["pairing", "list"]];

  static override usage = Command.Usage({
    description: "List pending pairing requests",
    examples: [["List all pending requests", "iris pairing list"]],
  });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const pairingStore = new PairingStore(stateDir);

    const pending = await pairingStore.listPending();

    if (pending.length === 0) {
      this.context.stdout.write("No pending pairing requests.\n");
      return;
    }

    this.context.stdout.write(`Pending pairing requests (${pending.length}):\n`);
    for (const req of pending) {
      const expiresIn = Math.max(
        0,
        Math.round((req.expiresAt - Date.now()) / 1000),
      );
      this.context.stdout.write(
        `  ${req.code}  channel=${req.channelId}  sender=${req.senderId}  expires in ${expiresIn}s\n`,
      );
    }
  }
}

export class PairingRevokeCommand extends Command {
  static override paths = [["pairing", "revoke"]];

  static override usage = Command.Usage({
    description: "Revoke a pending pairing code",
    examples: [["Revoke a code", "iris pairing revoke ABCD1234"]],
  });

  code = Option.String({ name: "code", required: true });

  async execute(): Promise<void> {
    const stateDir = getStateDir();
    const pairingStore = new PairingStore(stateDir);

    const revoked = await pairingStore.revokeCode(this.code);

    if (revoked) {
      this.context.stdout.write(`Revoked pairing code: ${this.code}\n`);
    } else {
      this.context.stdout.write(
        `No pending pairing request found for code: ${this.code}\n`,
      );
      process.exitCode = 1;
    }
  }
}
