import { type Bot, InputFile } from "grammy";
import type { SendMediaParams } from "../adapter.js";

export async function sendText(
  bot: Bot,
  to: string,
  text: string,
  replyToId?: string,
): Promise<{ messageId: string }> {
  const msg = await bot.api.sendMessage(to, text, {
    reply_parameters: replyToId
      ? { message_id: Number(replyToId) }
      : undefined,
  });
  return { messageId: String(msg.message_id) };
}

export async function sendMedia(
  bot: Bot,
  params: SendMediaParams,
): Promise<{ messageId: string }> {
  const file = Buffer.isBuffer(params.source)
    ? new InputFile(new Uint8Array(params.source))
    : new InputFile(params.source);
  const caption = params.caption;

  let msgId: number;
  switch (params.type) {
    case "image": {
      const r = await bot.api.sendPhoto(params.to, file, { caption });
      msgId = r.message_id;
      break;
    }
    case "video": {
      const r = await bot.api.sendVideo(params.to, file, { caption });
      msgId = r.message_id;
      break;
    }
    case "audio": {
      const r = await bot.api.sendAudio(params.to, file, { caption });
      msgId = r.message_id;
      break;
    }
    case "document":
    default: {
      const r = await bot.api.sendDocument(params.to, file, { caption });
      msgId = r.message_id;
      break;
    }
  }
  return { messageId: String(msgId) };
}

export async function editMessage(
  bot: Bot,
  chatId: string,
  messageId: string,
  text: string,
): Promise<void> {
  await bot.api.editMessageText(chatId, Number(messageId), text);
}

export async function deleteMessage(
  bot: Bot,
  chatId: string,
  messageId: string,
): Promise<void> {
  await bot.api.deleteMessage(chatId, Number(messageId));
}

export async function sendTyping(bot: Bot, to: string): Promise<void> {
  await bot.api.sendChatAction(to, "typing");
}

export async function sendReaction(
  bot: Bot,
  chatId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await bot.api.setMessageReaction(chatId, Number(messageId), [
    { type: "emoji", emoji } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ]);
}
