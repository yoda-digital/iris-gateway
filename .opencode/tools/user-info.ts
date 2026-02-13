import { z } from "zod";

export default {
  name: "user_info",
  description: "Query information about a user on a messaging channel",
  parameters: z.object({
    channel: z.string().describe("Channel ID"),
    userId: z.string().describe("User ID to look up"),
  }),
  execute: async ({ channel, userId }: { channel: string; userId: string }) => {
    try {
      const response = await fetch("http://127.0.0.1:19877/tool/user-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, userId }),
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
