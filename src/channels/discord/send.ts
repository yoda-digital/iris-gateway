import { AttachmentBuilder, type Client, type TextChannel, type DMChannel } from "discord.js";
import type { SendMediaParams } from "../adapter.js";

export async function sendText(
  client: Client,
  to: string,
  text: string,
  replyToId?: string,
): Promise<{ messageId: string }> {
  const channel = await client.channels.fetch(to);
  if (!channel || !("send" in channel)) {
    throw new Error(`Cannot send to channel: ${to}`);
  }
  const textChannel = channel as TextChannel | DMChannel;
  const msg = await textChannel.send({
    content: text,
    reply: replyToId ? { messageReference: replyToId } : undefined,
  });
  return { messageId: msg.id };
}

export async function sendMedia(
  client: Client,
  params: SendMediaParams,
): Promise<{ messageId: string }> {
  const channel = await client.channels.fetch(params.to);
  if (!channel || !("send" in channel)) {
    throw new Error(`Cannot send to channel: ${params.to}`);
  }
  const textChannel = channel as TextChannel | DMChannel;
  const attachment = new AttachmentBuilder(
    Buffer.isBuffer(params.source) ? params.source : params.source,
    { name: params.filename ?? "file" },
  );
  const msg = await textChannel.send({
    content: params.caption ?? undefined,
    files: [attachment],
  });
  return { messageId: msg.id };
}

export async function editMessage(
  client: Client,
  channelId: string,
  messageId: string,
  text: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (channel && "messages" in channel) {
    const msg = await (channel as TextChannel).messages.fetch(messageId);
    await msg.edit(text);
  }
}

export async function deleteMessage(
  client: Client,
  channelId: string,
  messageId: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (channel && "messages" in channel) {
    const msg = await (channel as TextChannel).messages.fetch(messageId);
    await msg.delete();
  }
}

export async function sendTyping(
  client: Client,
  to: string,
): Promise<void> {
  const channel = await client.channels.fetch(to);
  if (channel && "sendTyping" in channel) {
    await (channel as TextChannel).sendTyping();
  }
}

export async function sendReaction(
  client: Client,
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (channel && "messages" in channel) {
    const msg = await (channel as TextChannel).messages.fetch(messageId);
    await msg.react(emoji);
  }
}
