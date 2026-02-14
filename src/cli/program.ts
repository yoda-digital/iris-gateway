import { Cli } from "clipanion";
import { GatewayRunCommand } from "./commands/gateway.js";
import {
  PairingApproveCommand,
  PairingListCommand,
  PairingRevokeCommand,
} from "./commands/pairing.js";
import { StatusCommand } from "./commands/status.js";
import {
  SessionListCommand,
  SessionResetCommand,
} from "./commands/session.js";
import {
  ConfigShowCommand,
  ConfigValidateCommand,
} from "./commands/config-cmd.js";
import { SendCommand } from "./commands/send.js";
import {
  CronListCommand,
  CronAddCommand,
  CronRemoveCommand,
} from "./commands/cron-cmd.js";
import {
  SecurityAllowlistListCommand,
  SecurityAllowlistAddCommand,
} from "./commands/security.js";
import { DoctorCommand } from "./commands/doctor.js";
import { ScanCommand } from "./commands/scan.js";

export function createCli(): Cli {
  const cli = new Cli({
    binaryLabel: "Iris",
    binaryName: "iris",
    binaryVersion: "0.2.0",
  });

  cli.register(GatewayRunCommand);

  // Pairing commands
  cli.register(PairingApproveCommand);
  cli.register(PairingListCommand);
  cli.register(PairingRevokeCommand);

  // Status
  cli.register(StatusCommand);

  // Session commands
  cli.register(SessionListCommand);
  cli.register(SessionResetCommand);

  // Config commands
  cli.register(ConfigShowCommand);
  cli.register(ConfigValidateCommand);

  // Send command
  cli.register(SendCommand);

  // Cron commands
  cli.register(CronListCommand);
  cli.register(CronAddCommand);
  cli.register(CronRemoveCommand);

  // Security commands
  cli.register(SecurityAllowlistListCommand);
  cli.register(SecurityAllowlistAddCommand);

  // Doctor
  cli.register(DoctorCommand);

  // Security scan
  cli.register(ScanCommand);

  return cli;
}
