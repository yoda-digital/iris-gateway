import { execFile } from "node:child_process";
import type { CliExecResult } from "./types.js";
import type { Logger } from "../logging/logger.js";

export interface CliExecutorOpts {
  allowedBinaries: string[];
  timeout: number;
  logger: Logger;
}

export class CliExecutor {
  private readonly allowed: Set<string>;
  private readonly timeout: number;
  private readonly logger: Logger;

  constructor(opts: CliExecutorOpts) {
    this.allowed = new Set(opts.allowedBinaries);
    this.timeout = opts.timeout;
    this.logger = opts.logger;
  }

  async exec(binary: string, args: string[]): Promise<CliExecResult> {
    if (!this.allowed.has(binary)) {
      return {
        ok: false,
        error: `Binary '${binary}' not in sandbox allowlist`,
        exitCode: -1,
      };
    }

    return new Promise<CliExecResult>((resolve) => {
      execFile(
        binary,
        args,
        { timeout: this.timeout, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const output = stdout.trim();

          if (error) {
            if (error.killed || (error as any).code === "ETIMEDOUT") {
              resolve({
                ok: false,
                error: `Command timed out after ${this.timeout}ms`,
                exitCode: -1,
              });
              return;
            }

            resolve({
              ok: false,
              error: stderr.trim() || error.message,
              exitCode: error.code != null ? (typeof error.code === "number" ? error.code : 1) : 1,
            });
            return;
          }

          let data: unknown;
          try {
            data = JSON.parse(output);
          } catch {
            data = output;
          }

          resolve({ ok: true, data, exitCode: 0 });
        },
      );
    });
  }
}
