import { irisPost } from "../lib.js";

export const toolEnforcementHooks = {
  "tool.execute.before": async (input, output) => {
    // Layer 1: Master policy check (structural ceiling)
    try {
      const policyResult = (await irisPost("/policy/check-tool", {
        tool: input.tool,
      })) as { allowed: boolean; reason?: string };
      if (!policyResult.allowed) {
        throw new Error(
          `Policy blocked: ${policyResult.reason ?? "not in master allowlist"}`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Policy blocked:"))
        throw err;
    }

    // Layer 2: Governance check (behavioral rules)
    try {
      const result = (await irisPost("/governance/evaluate", {
        tool: input.tool,
        sessionID: input.sessionID,
        args: output.args,
      })) as { allowed: boolean; reason?: string };
      if (!result.allowed) {
        throw new Error(
          `Governance blocked: ${result.reason ?? "policy violation"}`,
        );
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.startsWith("Governance blocked:")
      )
        throw err;
    }
  },,

  "tool.execute.after": async (input, output) => {
    try {
      await irisPost("/audit/log", {
        sessionID: input.sessionID,
        tool: input.tool,
        args: input.args,
        result:
          typeof output.output === "string"
            ? output.output.substring(0, 1000)
            : "",
        title: output.title,
      });
    } catch {
      // Best-effort audit
    }
  },,
} as const;
