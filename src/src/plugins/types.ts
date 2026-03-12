import type { z } from "zod";
import type { ChannelAdapter } from "../channels/adapter.js";
import type { ChannelAccountConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type { IrisConfig } from "../config/types.js";

export interface IrisPlugin {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  register(api: IrisPluginApi): void | Promise<void>;
}

export interface IrisPluginApi {
  registerTool(name: string, def: PluginToolDef): void;
  registerChannel(id: string, factory: ChannelFactory): void;
  registerService(name: string, service: PluginService): void;
  registerHook<K extends keyof HookMap>(event: K, handler: HookHandler<K>): void;
  readonly config: Readonly<IrisConfig>;
  readonly logger: Logger;
  readonly stateDir: string;
}

export interface PluginToolDef {
  readonly description: string;
  readonly args: Record<string, z.ZodTypeAny>;
  execute(args: Record<string, unknown>, ctx: ToolExecContext): Promise<unknown>;
}

export interface ToolExecContext {
  readonly sessionId: string | null;
  readonly senderId: string | null;
  readonly channelId: string | null;
  readonly logger: Logger;
}

export type ChannelFactory = (config: ChannelAccountConfig, signal: AbortSignal) => ChannelAdapter;

export interface PluginService {
  start(ctx: ServiceContext): Promise<void>;
  stop(): Promise<void>;
}

export interface ServiceContext {
  readonly config: Readonly<IrisConfig>;
  readonly logger: Logger;
  readonly stateDir: string;
  readonly signal: AbortSignal;
}

// Hook system
export interface HookMap {
  "message.inbound": { message: { channelId: string; senderId: string; text: string } };
  "message.outbound": { channelId: string; chatId: string; text: string };
  "gateway.ready": void;
  "gateway.shutdown": void;
}

export type HookHandler<K extends keyof HookMap> =
  HookMap[K] extends void
    ? () => void | Promise<void>
    : (data: HookMap[K]) => void | Promise<void>;

export interface PluginManifestTool {
  readonly description: string;
  readonly args: Record<string, string>;
}

export interface PluginManifest {
  readonly tools: Record<string, PluginManifestTool>;
}
