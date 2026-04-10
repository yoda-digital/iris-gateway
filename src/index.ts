export type { MessageRouterConfig } from "./bridge/message-router.js";

import { createCli } from "./cli/program.js";

const cli = createCli();
cli.runExit(process.argv.slice(2));
