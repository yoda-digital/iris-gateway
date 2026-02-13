import { z } from "zod";

export default {
  name: "list_channels",
  description: "List all active messaging channels and their status",
  parameters: z.object({}),
  execute: async () => {
    try {
      const response = await fetch("http://127.0.0.1:19877/tool/list-channels", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
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
