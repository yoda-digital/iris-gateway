import { irisPost } from "../lib.js";

export const sessionCompactingHook = {
  "experimental.session.compacting": async (input, output) => {
    try {
      const insights = (await irisPost("/vault/extract", {
        sessionID: input.sessionID,
        context: output.context,
      })) as { facts: Array<{ content: string; type: string }> };

      if (insights.facts?.length > 0) {
        await irisPost("/vault/store-batch", {
          sessionID: input.sessionID,
          memories: insights.facts,
        });
        output.context.push(
          `[${insights.facts.length} memories extracted and stored]`,
        );
      }
    } catch {
      // Best-effort
    }
  },,
} as const;
