import { z } from "zod";

export default {
  name: "channel_action",
  description: "Perform a channel action: typing indicator, reaction, edit, or delete",
  parameters: z.object({
    channel: z.string().describe("Channel ID"),
    action: z.enum(["typing", "react", "edit", "delete"]).describe("Action type"),
    chatId: z.string().describe("Chat/conversation ID"),
    messageId: z.string().optional().describe("Target message ID (for react/edit/delete)"),
    emoji: z.string().optional().describe("Emoji for reaction"),
    text: z.string().optional().describe("New text for edit"),
  }),
  execute: async (params: Record<string, unknown>) => {
    try {
      const response = await fetch("http://127.0.0.1:19877/tool/channel-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const body = await response.text();
        return JSON.stringify({ error: `HTTP ${response.status}: ${body}` });
      }
      return JSON.stringify(await response.json());
    } catch (err) {
      return JSON.stringify({ error: String(err) });
    }
  },
};
