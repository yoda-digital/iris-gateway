import { createCli } from "./cli/program.js";

const cli = createCli();
cli.runExit(process.argv.slice(2));
