import { tool } from "@opencode-ai/plugin";
import { irisPost, irisGet, IRIS_URL } from "../lib.js";

export const vaultTools = {
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
    }),,

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
    }),,

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
    }),,
} as const;
