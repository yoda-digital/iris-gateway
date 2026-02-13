import type { WASocket, AnyMessageContent } from "@whiskeysockets/baileys";
import { readFile } from "node:fs/promises";
import type { SendMediaParams } from "../adapter.js";

export async function sendText(
  socket: WASocket,
  to: string,
  text: string,
): Promise<{ messageId: string }> {
  const result = await socket.sendMessage(to, { text });
  return { messageId: result?.key.id ?? "" };
}

export async function sendMedia(
  socket: WASocket,
  params: SendMediaParams,
): Promise<{ messageId: string }> {
  const buffer = Buffer.isBuffer(params.source)
    ? params.source
    : await readFile(params.source);

  let content: AnyMessageContent;
  switch (params.type) {
    case "image":
      content = { image: buffer, caption: params.caption, mimetype: params.mimeType };
      break;
    case "video":
      content = { video: buffer, caption: params.caption, mimetype: params.mimeType };
      break;
    case "audio":
      content = { audio: buffer, mimetype: params.mimeType };
      break;
    case "document":
    default:
      content = {
        document: buffer,
        mimetype: params.mimeType,
        fileName: params.filename ?? "file",
        caption: params.caption,
      };
      break;
  }

  const result = await socket.sendMessage(params.to, content);
  return { messageId: result?.key.id ?? "" };
}

export async function editMessage(
  socket: WASocket,
  to: string,
  messageId: string,
  text: string,
): Promise<void> {
  await socket.sendMessage(to, {
    text,
    edit: { remoteJid: to, id: messageId, fromMe: true },
  });
}

export async function deleteMessage(
  socket: WASocket,
  to: string,
  messageId: string,
): Promise<void> {
  await socket.sendMessage(to, {
    delete: { remoteJid: to, id: messageId, fromMe: true },
  });
}

export async function sendTyping(
  socket: WASocket,
  to: string,
): Promise<void> {
  await socket.sendPresenceUpdate("composing", to);
}
