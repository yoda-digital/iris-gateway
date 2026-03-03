import { irisPost, irisGet } from "../lib.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IrisClient = any;

export function buildSystemTransformHook(client: IrisClient) {
  return {
    "experimental.chat.system.transform": async (input, output) => {
    try {
      const ctx = (await irisPost("/session/system-context", {
        sessionID: input.sessionID,
      })) as {
        directives?: string;
        channelRules?: string;
        userContext?: string;
        intelligenceContext?: string;
      };

      if (ctx.directives) output.system.push(ctx.directives);
      if (ctx.channelRules) output.system.push(ctx.channelRules);
      if (ctx.userContext) output.system.push(ctx.userContext);

      // Intelligence layer context (arcs, goals, proactive insights, cross-channel, health)
      if (ctx.intelligenceContext) output.system.push(ctx.intelligenceContext);

      // Profile learning injection
      if (ctx.userContext) {
        output.system.push(
          `[PROFILE LEARNING] When you learn something new about the user, use enrich_profile silently. Already known: ${ctx.userContext}`,
        );
      } else {
        output.system.push(
          "[PROFILE LEARNING] Nothing known about this user yet. As you learn things (name, language, timezone, interests, preferences), use enrich_profile to store them. Don't interrogate — learn naturally from conversation.",
        );
      }

      // Proactive awareness injection
      try {
        if (input.sessionID) {
          const pending = (await irisGet("/proactive/pending?limit=5")) as {
            intents: Array<{ what: string }>;
            triggers: Array<{ type: string }>;
          };
          const pendingCount =
            (pending.intents?.length ?? 0) + (pending.triggers?.length ?? 0);

          const block = [
            "[PROACTIVE INTELLIGENCE]",
            "You have proactive follow-up capability. Use proactive_intent to schedule check-ins.",
            "You can track user goals with goal_create/goal_update/goal_complete/goal_list.",
            "Narrative arcs (ongoing situations) are tracked automatically — use arc_list to review.",
            pendingCount > 0
              ? `You have ${pendingCount} pending proactive items.`
              : "No pending items.",
          ];
          output.system.push(block.join("\n"));
        }
      } catch {
        // Best-effort
      }

      // Proactive skill triggering: get latest user message and match against skill triggers
      if (input.sessionID) {
        try {
          const msgs = await client.v2.session.message.list({ path: { sessionID: input.sessionID } });
          const userMsgs = (msgs.data ?? []).filter((m: { role: string }) => m.role === "user");
          const latest = userMsgs[userMsgs.length - 1] as { parts?: Array<{ type: string; text?: string }> } | undefined;
          const latestText = latest?.parts?.find((p: { type: string }) => p.type === "text")?.text;

          if (latestText) {
            const result = (await irisPost("/skills/suggest", { text: latestText })) as {
              suggestions: Array<{ name: string; description: string }>;
            };

            if (result.suggestions?.length > 0) {
              const skillList = result.suggestions
                .map((s) => `- ${s.name}: ${s.description}`)
                .join("\n");
              output.system.push(
                `[RECOMMENDED SKILLS for this message — invoke these with the skill tool:\n${skillList}]`,
              );
            }
          }
        } catch {
          // Best-effort — don't fail the LLM call if skill matching fails
        }
      }
    } catch {
      // Best-effort
    }
  },,
  } as const;
}
