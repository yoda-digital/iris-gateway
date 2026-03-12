import { readFile } from "node:fs/promises";
import type { App } from "@slack/bolt";
import type { SendMediaParams } from "../adapter.js";

export async function sendText(
  app: App,
  to: string,
  text: string,
  replyToId?: string,
): Promise<{ messageId: string }> {
  const result = await app.client.chat.postMessage({
    channel: to,
    text,
    thread_ts: replyToId,
  });
  return { messageId: result.ts ?? "" };
}

export async function sendMedia(
  app: App,
  params: SendMediaParams,
): Promise<{ messageId: string }> {
  const buffer = Buffer.isBuffer(params.source)
    ? params.source
    : await readFile(params.source);

  const result = await app.client.filesUploadV2({
    channel_id: params.to,
    file: buffer,
    filename: params.filename ?? "file",
    initial_comment: params.caption,
  });
  // filesUploadV2 returns file info in the files array
  const firstFile = Array.isArray(result.files) ? result.files[0] : undefined;
  const fileId = firstFile ? String((firstFile as unknown as { id?: string }).id ?? "") : "";
  return { messageId: fileId };
}

export async function editMessage(
  app: App,
  channel: string,
  messageId: string,
  text: string,
): Promise<void> {
  await app.client.chat.update({
    channel,
    ts: messageId,
    text,
  });
}

export async function deleteMessage(
  app: App,
  channel: string,
  messageId: string,
): Promise<void> {
  await app.client.chat.delete({
    channel,
    ts: messageId,
  });
}

export async function sendTyping(
  _app: App,
  _to: string,
): Promise<void> {
  // Slack doesn't have a direct typing indicator API for bots
}

export async function sendReaction(
  app: App,
  channel: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await app.client.reactions.add({
    channel,
    timestamp: messageId,
    name: emoji.replace(/:/g, ""),
  });
}
