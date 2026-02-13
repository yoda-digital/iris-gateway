import { z } from "zod";

export default {
  name: "send_message",
  description: "Send a text or media message to a user on a messaging channel",
  parameters: z.object({
    channel: z.string().describe("Channel ID: telegram, whatsapp, discord, slack"),
    to: z.string().describe("Chat/conversation ID to send to"),
    text: z.string().describe("Message text to send"),
    replyToId: z.string().optional().describe("Message ID to reply to"),
    mediaUrl: z.string().optional().describe("URL of media to attach (image, video, audio, document)"),
    mediaType: z.enum(["image", "video", "audio", "document"]).optional().describe("Type of media being sent"),
  }),
  execute: async ({ channel, to, text, replyToId, mediaUrl, mediaType }: { channel: string; to: string; text: string; replyToId?: string; mediaUrl?: string; mediaType?: string }) => {
    try {
      const response = await fetch("http://127.0.0.1:19877/tool/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, to, text, replyToId, mediaUrl, mediaType }),
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
