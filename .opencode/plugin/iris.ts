import type { Plugin } from "@opencode-ai/plugin";
import { loadPluginTools, loadCliTools } from "./lib.js";
import { channelTools } from "./tools/channel.js";
import { vaultTools } from "./tools/vault.js";
import { governanceTools } from "./tools/governance.js";
import { skillsTools } from "./tools/skills.js";
import { intelligenceTools } from "./tools/intelligence.js";
import { systemTools } from "./tools/system.js";
import { toolEnforcementHooks } from "./hooks/tool-enforcement.js";
import { sessionCompactingHook } from "./hooks/session-compacting.js";
import { permissionHook } from "./hooks/permission.js";
import { buildSystemTransformHook } from "./hooks/system-transform.js";

export default (async ({ client }) => ({
  tool: {
    ...loadPluginTools(),
    ...loadCliTools(),
    ...channelTools,
    ...vaultTools,
    ...governanceTools,
    ...skillsTools,
    ...intelligenceTools,
    ...systemTools,
  },

  ...toolEnforcementHooks,
  ...sessionCompactingHook,
  ...permissionHook,
  ...buildSystemTransformHook(client),
})) satisfies Plugin;
