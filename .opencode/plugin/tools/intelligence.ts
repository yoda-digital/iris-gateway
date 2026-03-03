import { tool } from "@opencode-ai/plugin";
import { irisPost, irisGet } from "../lib.js";

export const intelligenceTools = {
  proactive_intent: tool({
      description:
        "Register a follow-up intent. Use when you want to check back on something later. " +
        "Examples: user committed to doing something, you asked a question, you suggested " +
        "something worth revisiting, you noticed something that needs monitoring.",
      args: {
        what: tool.schema.string().describe("What to follow up on"),
        why: tool.schema.string().optional().describe("Why this matters"),
        category: tool.schema
          .string()
          .optional()
          .describe(
            "Category for engagement tracking: task, work, health, hobby, social, reminder, general. " +
            "Pick the one that best fits the follow-up topic. Default: general",
          ),
        delayMs: tool.schema
          .number()
          .optional()
          .describe("Milliseconds until follow-up (default: 24h = 86400000)"),
        confidence: tool.schema
          .number()
          .optional()
          .describe("How confident you are this needs follow-up, 0-1 (default: 0.8)"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisPost("/proactive/intent", {
            sessionID: (this as any).sessionID,
            what: args.what,
            why: args.why,
            category: args.category,
            delayMs: args.delayMs,
            confidence: args.confidence,
          }),
        );
      },
    }),,

  proactive_cancel: tool({
      description: "Cancel a pending proactive intent by ID.",
      args: {
        id: tool.schema.string().describe("Intent ID to cancel"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/proactive/cancel", args));
      },
    }),,

  proactive_list: tool({
      description:
        "List pending proactive intents and triggers. Use to see what follow-ups are scheduled.",
      args: {
        limit: tool.schema
          .number()
          .optional()
          .describe("Max results (default: 20)"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisGet(`/proactive/pending?limit=${args.limit ?? 20}`),
        );
      },
    }),,

  proactive_quota: tool({
      description:
        "Check your proactive message quota and engagement rate for a user. " +
        "Use before deciding whether to register an intent.",
      args: {
        senderId: tool.schema.string().describe("User's sender ID"),
        channelId: tool.schema.string().describe("Channel ID"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisGet(
            `/proactive/quota?senderId=${encodeURIComponent(args.senderId)}&channelId=${encodeURIComponent(args.channelId)}`,
          ),
        );
      },
    }),,

  proactive_scan: tool({
      description:
        "Force a passive scan for dormant users. Returns list of users who have been inactive.",
      args: {
        thresholdMs: tool.schema
          .number()
          .optional()
          .describe("Inactive for N ms (default: 7 days)"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisPost("/proactive/scan", { thresholdMs: args.thresholdMs }),
        );
      },
    }),,

  proactive_execute: tool({
      description: "Manually trigger execution of a specific pending intent now.",
      args: {
        id: tool.schema.string().describe("Intent ID to execute immediately"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/proactive/execute", args));
      },
    }),,

  proactive_engage: tool({
      description:
        "Record that a user engaged with a proactive message (replied). " +
        "This improves the engagement rate used for self-tuning.",
      args: {
        senderId: tool.schema.string().describe("User who engaged"),
        channelId: tool.schema.string().describe("Channel"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisPost("/proactive/engage", {
            senderId: args.senderId,
            channelId: args.channelId,
          }),
        );
      },
    }),,

  goal_create: tool({
      description:
        "Create a goal for the user. Use when they mention something they want to achieve, " +
        "a project they're working on, or a commitment they've made. Goals persist across sessions.",
      args: {
        description: tool.schema.string().describe("What the user wants to achieve"),
        successCriteria: tool.schema.string().optional().describe("How to know the goal is done"),
        nextAction: tool.schema.string().optional().describe("Next concrete step"),
        nextActionDue: tool.schema.number().optional().describe("When next action is due (Unix ms)"),
        priority: tool.schema.number().optional().describe("1-100 priority (default: 50)"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisPost("/goals/create", {
            sessionID: (this as any).sessionID,
            description: args.description,
            successCriteria: args.successCriteria,
            nextAction: args.nextAction,
            nextActionDue: args.nextActionDue,
            priority: args.priority,
          }),
        );
      },
    }),,

  goal_update: tool({
      description:
        "Update progress on an existing goal. Add a progress note and optionally set next action.",
      args: {
        id: tool.schema.string().describe("Goal ID"),
        progressNote: tool.schema.string().describe("What progress was made"),
        nextAction: tool.schema.string().optional().describe("New next action"),
        nextActionDue: tool.schema.number().optional().describe("When next action is due (Unix ms)"),
      },
      async execute(args) {
        return JSON.stringify(
          await irisPost("/goals/update", {
            id: args.id,
            progressNote: args.progressNote,
            nextAction: args.nextAction,
            nextActionDue: args.nextActionDue,
          }),
        );
      },
    }),,

  goal_complete: tool({
      description: "Mark a goal as completed. Use when the user achieves their goal.",
      args: {
        id: tool.schema.string().describe("Goal ID to complete"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/goals/complete", { id: args.id }));
      },
    }),,

  goal_list: tool({
      description:
        "List the user's active and paused goals. Use to check what they're working on.",
      args: {},
      async execute() {
        return JSON.stringify(
          await irisPost("/goals/list", {
            sessionID: (this as any).sessionID,
          }),
        );
      },
    }),,

  goal_pause: tool({
      description: "Pause a goal temporarily. Use when the user wants to focus on other things.",
      args: {
        id: tool.schema.string().describe("Goal ID to pause"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/goals/pause", { id: args.id }));
      },
    }),,

  goal_resume: tool({
      description: "Resume a paused goal.",
      args: {
        id: tool.schema.string().describe("Goal ID to resume"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/goals/resume", { id: args.id }));
      },
    }),,

  goal_abandon: tool({
      description: "Abandon a goal. Use when the user explicitly gives up or the goal is no longer relevant.",
      args: {
        id: tool.schema.string().describe("Goal ID to abandon"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/goals/abandon", { id: args.id }));
      },
    }),,

  arc_list: tool({
      description:
        "List active narrative arcs (ongoing situations/threads) for the user.",
      args: {},
      async execute() {
        return JSON.stringify(
          await irisPost("/arcs/list", {
            sessionID: (this as any).sessionID,
          }),
        );
      },
    }),,

  arc_resolve: tool({
      description: "Mark a narrative arc as resolved. Use when a situation concludes.",
      args: {
        id: tool.schema.string().describe("Arc ID"),
        summary: tool.schema.string().optional().describe("Resolution summary"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/arcs/resolve", { id: args.id, summary: args.summary }));
      },
    }),,
} as const;
