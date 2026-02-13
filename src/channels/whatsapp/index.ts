import type { WASocket } from "@whiskeysockets/baileys";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelEvents,
  SendTextParams,
  SendMediaParams,
} from "../adapter.js";
import { TypedEventEmitter } from "../../utils/typed-emitter.js";
import type { ChannelAccountConfig } from "../../config/types.js";
import { normalizeWhatsAppMessage } from "./normalize.js";
import { createWhatsAppSocket } from "./connection.js";
import * as send from "./send.js";

const CAPABILITIES: ChannelCapabilities = {
  text: true,
  image: true,
  video: true,
  audio: true,
  document: true,
  reaction: true,
  typing: true,
  edit: true,
  delete: true,
  reply: true,
  thread: false,
  maxTextLength: 65536,
};

export class WhatsAppAdapter implements ChannelAdapter {
  readonly id = "whatsapp";
  readonly label = "WhatsApp";
  readonly capabilities = CAPABILITIES;
  readonly events = new TypedEventEmitter<ChannelEvents>();

  private socket: WASocket | null = null;

  async start(
    _config: ChannelAccountConfig,
    signal: AbortSignal,
  ): Promise<void> {
    const { socket, onConnectionUpdate } =
      await createWhatsAppSocket(signal);

    this.socket = socket;

    onConnectionUpdate((update) => {
      if (update.connection === "open") {
        this.events.emit("connected");
      }
      if (update.connection === "close") {
        this.events.emit("disconnected", "connection closed");
      }
    });

    socket.ev.on("messages.upsert", ({ messages }) => {
      for (const raw of messages) {
        const msg = normalizeWhatsAppMessage(raw);
        if (msg) this.events.emit("message", msg);
      }
    });

    signal.addEventListener("abort", () => {
      this.socket?.end(undefined);
    });
  }

  async stop(): Promise<void> {
    this.socket?.end(undefined);
    this.socket = null;
    this.events.emit("disconnected", "stopped");
  }

  async sendText(params: SendTextParams): Promise<{ messageId: string }> {
    if (!this.socket) throw new Error("WhatsApp not connected");
    return send.sendText(this.socket, params.to, params.text);
  }

  async sendMedia(params: SendMediaParams): Promise<{ messageId: string }> {
    if (!this.socket) throw new Error("WhatsApp not connected");
    return send.sendMedia(this.socket, params);
  }

  async editMessage(params: { messageId: string; text: string; chatId?: string }): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp not connected");
    const to = params.chatId;
    if (!to) throw new Error("chatId required for WhatsApp edit");
    await send.editMessage(this.socket, to, params.messageId, params.text);
  }

  async deleteMessage(params: { messageId: string; chatId?: string }): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp not connected");
    const to = params.chatId;
    if (!to) throw new Error("chatId required for WhatsApp delete");
    await send.deleteMessage(this.socket, to, params.messageId);
  }

  async sendReaction(params: { messageId: string; emoji: string; chatId?: string }): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp not connected");
    const to = params.chatId;
    if (!to) throw new Error("chatId required for WhatsApp reaction");
    await this.socket.sendMessage(to, {
      react: { text: params.emoji, key: { remoteJid: to, id: params.messageId, fromMe: false } },
    });
  }

  async sendTyping(params: { to: string }): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp not connected");
    await send.sendTyping(this.socket, params.to);
  }
}
