/**
 * Shared inbound message types.
 *
 * Lives in `src/types/` so that both `channels/` and `intelligence/` can
 * import from a layer below both — satisfying the dependency-direction rule
 * in VISION.md §6 (intelligence/ → gateway core, channels/ → gateway core).
 *
 * Previously `InboundMessage` and `InboundMedia` were defined in
 * `src/channels/adapter.ts`, which forced `intelligence/triggers/` to import
 * upward from `channels/` — a direction violation.
 */

export interface InboundMessage {
  readonly id: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly chatId: string;
  readonly chatType: "dm" | "group";
  readonly text?: string;
  readonly media?: InboundMedia[];
  readonly replyToId?: string;
  readonly timestamp: number;
  readonly raw: unknown;
}

export interface InboundMedia {
  readonly type: "image" | "video" | "audio" | "document";
  readonly mimeType: string;
  readonly url?: string;
  readonly buffer?: Buffer;
  readonly filename?: string;
  readonly size?: number;
  readonly caption?: string;
}
