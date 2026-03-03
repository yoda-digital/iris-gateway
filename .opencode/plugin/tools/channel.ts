import { tool } from "@opencode-ai/plugin";
import { irisPost, irisGet } from "../lib.js";

export const channelTools = {
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
    }),,

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
    }),,

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
    }),,

  user_info: tool({
      description: "Query information about a user on a messaging channel",
      args: {
        channel: tool.schema.string().describe("Channel ID"),
        userId: tool.schema.string().describe("User ID to look up"),
      },
      async execute(args) {
        return JSON.stringify(await irisPost("/tool/user-info", args));
      },
    }),,

  list_channels: tool({
      description: "List all active messaging channels and their status",
      args: {},
      async execute() {
        return JSON.stringify(await irisGet("/tool/list-channels"));
      },
    }),,
} as const;
