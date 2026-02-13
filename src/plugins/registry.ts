import type { IrisConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type {
  IrisPluginApi,
  PluginToolDef,
  ChannelFactory,
  PluginService,
  PluginManifest,
  HookMap,
  HookHandler,
} from "./types.js";
import { HookBus } from "./hook-bus.js";

export class PluginRegistry {
  readonly tools = new Map<string, PluginToolDef>();
  readonly channels = new Map<string, ChannelFactory>();
  readonly services = new Map<string, PluginService>();
  readonly hookBus = new HookBus();

  createApi(
    pluginId: string,
    config: Readonly<IrisConfig>,
    logger: Logger,
    stateDir: string,
  ): IrisPluginApi {
    return {
      registerTool: (name, def) => { this.tools.set(name, def); },
      registerChannel: (id, factory) => { this.channels.set(id, factory); },
      registerService: (name, service) => { this.services.set(name, service); },
      registerHook: <K extends keyof HookMap>(event: K, handler: HookHandler<K>) => {
        this.hookBus.on(event, handler);
      },
      config,
      logger,
      stateDir,
    };
  }

  getManifest(): PluginManifest {
    const tools: PluginManifest["tools"] = {};
    for (const [name, def] of this.tools) {
      const args: Record<string, string> = {};
      for (const [argName, zodType] of Object.entries(def.args)) {
        args[argName] = String((zodType as { _def?: { typeName?: string } })?._def?.typeName ?? "string");
      }
      tools[name] = { description: def.description, args };
    }
    return { tools };
  }
}
