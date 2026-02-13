import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const IRIS_URL =
  process.env.IRIS_TOOL_SERVER_URL || "http://127.0.0.1:19877";

async function irisPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${IRIS_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return res.json();
}

async function irisGet(path: string): Promise<unknown> {
  const res = await fetch(`${IRIS_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  return res.json();
}

export default (async ({ client }) => ({
  // ── TOOLS ──
  tool: {
    send_message: tool({
      description: "Send a text message to a user on a messaging channel",
      args: {
        channel: tool.schema
          .string()
          .describe("Channel ID: telegram, whatsapp, discord, slack"),
        to: tool.schema.string().describe("Chat/conversation ID to send to"),
        text: tool.schema.string().describe("Message text to send"),
        replyToId: tool.schema
          .string()
          .optional()
          .describe("Message ID to reply to"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/tool/send-message", args));
      },
    }),

    send_media: tool({
      description:
        "Send media (image, video, audio, document) to a messaging channel",
      args: {
        channel: tool.schema.string().describe("Channel ID"),
        to: tool.schema.string().describe("Chat/conversation ID"),
        type: tool.schema
          .enum(["image", "video", "audio", "document"])
          .describe("Media type"),
        url: tool.schema.string().describe("URL of media to send"),
        mimeType: tool.schema.string().optional(),
        filename: tool.schema.string().optional(),
        caption: tool.schema.string().optional(),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/tool/send-media", args));
      },
    }),

    channel_action: tool({
      description:
        "Perform a channel action: typing indicator, reaction, edit, or delete",
      args: {
        channel: tool.schema.string().describe("Channel ID"),
        action: tool.schema
          .enum(["typing", "react", "edit", "delete"])
          .describe("Action type"),
        chatId: tool.schema.string().describe("Chat/conversation ID"),
        messageId: tool.schema
          .string()
          .optional()
          .describe("Target message ID"),
        emoji: tool.schema
          .string()
          .optional()
          .describe("Emoji for reaction"),
        text: tool.schema
          .string()
          .optional()
          .describe("New text for edit"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/tool/channel-action", args));
      },
    }),

    user_info: tool({
      description: "Query information about a user on a messaging channel",
      args: {
        channel: tool.schema.string().describe("Channel ID"),
        userId: tool.schema.string().describe("User ID to look up"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/tool/user-info", args));
      },
    }),

    list_channels: tool({
      description: "List all active messaging channels and their status",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/tool/list-channels"));
      },
    }),

    vault_search: tool({
      description:
        "Search persistent memory for relevant information about a user or topic",
      args: {
        query: tool.schema.string().describe("Search query text"),
        senderId: tool.schema
          .string()
          .optional()
          .describe("Filter by sender ID"),
        type: tool.schema
          .enum(["fact", "preference", "event", "insight"])
          .optional(),
        limit: tool.schema
          .number()
          .optional()
          .describe("Max results (default 10)"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/vault/search", args));
      },
    }),

    vault_remember: tool({
      description:
        "Store a fact, preference, or insight about a user for future sessions",
      args: {
        content: tool.schema
          .string()
          .describe("The information to remember"),
        type: tool.schema.enum(["fact", "preference", "event", "insight"]),
        senderId: tool.schema.string().optional(),
        sessionId: tool.schema.string().optional(),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/vault/store", args));
      },
    }),

    vault_forget: tool({
      description: "Delete a specific memory by its ID",
      args: {
        id: tool.schema.string().describe("Memory ID to delete"),
      },
      async execute(args) {
        const res = await fetch(`${IRIS_URL}/vault/memory/${args.id}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(10_000),
        });
        return JSON.stringify(await res.json());
      },
    }),

    governance_status: tool({
      description: "Check current governance rules and directives",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/governance/rules"));
      },
    }),

    usage_summary: tool({
      description: "Get usage and cost summary for a user or all users",
      args: {
        senderId: tool.schema.string().optional().describe("Filter by sender ID"),
        since: tool.schema.number().optional().describe("Unix timestamp for start of period"),
        until: tool.schema.number().optional().describe("Unix timestamp for end of period"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/usage/summary", args));
      },
    }),

    skill_create: tool({
      description: "Create a new OpenCode skill with SKILL.md file",
      args: {
        name: tool.schema.string().describe("Skill name (lowercase, dashes, starts with letter)"),
        description: tool.schema.string().describe("Brief skill description"),
        content: tool.schema.string().describe("Skill content (markdown body after frontmatter)"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/skills/create", args));
      },
    }),

    skill_list: tool({
      description: "List all available OpenCode skills",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/skills/list"));
      },
    }),

    skill_delete: tool({
      description: "Delete an OpenCode skill by name",
      args: {
        name: tool.schema.string().describe("Skill name to delete"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/skills/delete", args));
      },
    }),

    agent_create: tool({
      description: "Create a new OpenCode agent with markdown file",
      args: {
        name: tool.schema.string().describe("Agent name (lowercase, dashes, starts with letter)"),
        prompt: tool.schema.string().describe("Agent system prompt"),
        mode: tool.schema.enum(["primary", "subagent", "all"]).optional().describe("Agent mode (default: subagent)"),
        model: tool.schema.string().optional().describe("Model override"),
        temperature: tool.schema.number().optional().describe("Temperature override"),
        tools: tool.schema.array(tool.schema.string()).optional().describe("Tool names to enable"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/agents/create", args));
      },
    }),

    agent_list: tool({
      description: "List all available OpenCode agents",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/agents/list"));
      },
    }),

    agent_delete: tool({
      description: "Delete an OpenCode agent by name",
      args: {
        name: tool.schema.string().describe("Agent name to delete"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/agents/delete", args));
      },
    }),
  },

  // ── HOOKS ──

  "tool.execute.before": async (input, output) => {
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
  },

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
  },

  "chat.message": async (input, output) => {
    try {
      const ctx = (await irisPost("/vault/context", {
        sessionID: input.sessionID,
      })) as {
        profile: Record<string, unknown> | null;
        memories: Array<{ content: string }>;
      };

      const blocks: string[] = [];
      if (ctx.profile) {
        const p = ctx.profile;
        blocks.push(
          `[User: ${p["name"] ?? "unknown"} | ${p["timezone"] ?? ""} | ${p["language"] ?? ""}]`,
        );
      }
      if (ctx.memories?.length > 0) {
        blocks.push(
          `[Relevant memories:\n${ctx.memories.map((m) => `- ${m.content}`).join("\n")}]`,
        );
      }
      if (blocks.length > 0) {
        output.parts.unshift({ type: "text", text: blocks.join("\n") });
      }
    } catch {
      // Don't fail message on context injection error
    }
  },

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
  },

  "experimental.chat.system.transform": async (input, output) => {
    try {
      const ctx = (await irisPost("/session/system-context", {
        sessionID: input.sessionID,
      })) as {
        directives?: string;
        channelRules?: string;
        userContext?: string;
      };

      if (ctx.directives) output.system.push(ctx.directives);
      if (ctx.channelRules) output.system.push(ctx.channelRules);
      if (ctx.userContext) output.system.push(ctx.userContext);
    } catch {
      // Best-effort
    }
  },

  "permission.ask": async (input, output) => {
    if (input.permission === "edit" || input.permission === "bash") {
      output.status = "deny";
    }
  },
})) satisfies Plugin;
