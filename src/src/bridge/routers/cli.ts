import { Hono } from "hono";
import { z } from "zod";
import type { Logger } from "../../logging/logger.js";
import type { CliExecutor } from "../../cli/executor.js";
import type { CliToolRegistry } from "../../cli/registry.js";

export interface CliDeps {
  logger: Logger;
  cliExecutor?: CliExecutor | null;
  cliRegistry?: CliToolRegistry | null;
}

const cliExecSchema = z.object({
  action: z.string().min(1),
}).passthrough();

export function cliRouter(deps: CliDeps): Hono {
  const app = new Hono();
  const { logger, cliExecutor, cliRegistry } = deps;

  app.post("/cli/:toolName", async (c) => {
    if (!cliExecutor || !cliRegistry) {
      return c.json({ error: "CLI tools not configured" }, 503);
    }

    const toolName = c.req.param("toolName");
    const parsed = cliExecSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
    }

    const { action, ...args } = parsed.data;
    try {
      const cmd = cliRegistry.buildCommand(toolName, action, args as Record<string, string>);
      const result = await cliExecutor.exec(cmd.binary, cmd.args);
      return c.json(result);
    } catch (err) {
      logger.error({ err, toolName, action }, "CLI tool execution failed");
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : String(err), exitCode: -1 },
        400,
      );
    }
  });

  return app;
}
