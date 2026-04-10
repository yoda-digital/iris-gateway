import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TemplateEngine } from "../auto-reply/engine.js";
import type { AutoReplyTemplate } from "../auto-reply/types.js";
import { CliExecutor } from "../cli/executor.js";
import { CliToolRegistry } from "../cli/registry.js";
import type { IrisConfig } from "../config/types.js";
import { GovernanceEngine } from "../governance/engine.js";
import { PolicyEngine } from "../governance/policy.js";
import type { Logger } from "../logging/logger.js";
import { ProfileEnricher } from "../onboarding/enricher.js";
import { SignalStore } from "../onboarding/signals.js";
import { UsageTracker } from "../usage/tracker.js";
import type { VaultDB } from "../vault/db.js";
import { VaultSearch } from "../vault/search.js";
import { VaultStore } from "../vault/store.js";

export interface CoreSubsystems {
  vaultStore: VaultStore;
  vaultSearch: VaultSearch;
  usageTracker: UsageTracker;
  governanceEngine: GovernanceEngine;
  policyEngine: PolicyEngine;
  signalStore: SignalStore | null;
  profileEnricher: ProfileEnricher | null;
}

export function buildCoreSubsystems(
  config: IrisConfig,
  vaultDb: VaultDB,
  logger: Logger,
): CoreSubsystems {
  const vaultStore = new VaultStore(vaultDb);
  const vaultSearch = new VaultSearch(vaultDb);
  const usageTracker = new UsageTracker(vaultDb);

  let signalStore: SignalStore | null = null;
  let profileEnricher: ProfileEnricher | null = null;
  if (config.onboarding?.enabled) {
    signalStore = new SignalStore(vaultDb);
    profileEnricher = new ProfileEnricher(signalStore, vaultStore, logger);
    logger.info("Onboarding enricher initialized");
  }

  const governanceEngine = new GovernanceEngine(
    config.governance ?? { enabled: false, rules: [], directives: [] },
  );

  const policyEngine = new PolicyEngine(
    config.policy ?? {
      enabled: false,
      tools: { allowed: [], denied: [] },
      permissions: { bash: "deny", edit: "deny", read: "deny" },
      agents: {
        allowedModes: ["subagent"],
        maxSteps: 0,
        requireDescription: true,
        defaultTools: ["vault_search", "skill"],
        allowPrimaryCreation: false,
      },
      skills: { restricted: [], requireTriggers: false },
      enforcement: { blockUnknownTools: true, auditPolicyViolations: true },
    },
  );
  if (policyEngine.enabled) logger.info("Master policy engine enabled");

  return {
    vaultStore,
    vaultSearch,
    usageTracker,
    governanceEngine,
    policyEngine,
    signalStore,
    profileEnricher,
  };
}

export interface CliComponents {
  cliExecutor: CliExecutor | null;
  cliRegistry: CliToolRegistry | null;
}

export async function buildCliTools(
  config: IrisConfig,
  stateDir: string,
  logger: Logger,
): Promise<CliComponents> {
  if (!config.cli?.enabled) {
    return { cliExecutor: null, cliRegistry: null };
  }

  const cliRegistry = new CliToolRegistry(config.cli.tools);
  const cliExecutor = new CliExecutor({
    allowedBinaries: config.cli.sandbox.allowedBinaries,
    timeout: config.cli.timeout,
    logger,
  });

  const probeResults = await Promise.all(
    cliRegistry.listTools().map(async (toolName) => {
      const def = cliRegistry.getToolDef(toolName)!;
      const result = await cliExecutor.probe(def.binary, def.healthCheck);
      return { toolName, binary: def.binary, ...result };
    }),
  );
  const unavailable = probeResults.filter((result) => !result.available);
  if (unavailable.length > 0) {
    for (const result of unavailable) {
      logger.warn(
        { tool: result.toolName, binary: result.binary, reason: result.reason },
        "CLI tool unavailable — removed from manifest",
      );
    }
    cliRegistry.removeTools(unavailable.map((result) => result.toolName));
  }

  const manifestPath = join(stateDir, "cli-tools.json");
  writeFileSync(manifestPath, JSON.stringify(cliRegistry.getManifest(), null, 2));
  logger.info(
    { tools: cliRegistry.listTools(), unavailable: unavailable.length },
    "CLI tool registry initialized",
  );

  return { cliExecutor, cliRegistry };
}

export function buildTemplateEngine(
  config: IrisConfig,
  logger: Logger,
): TemplateEngine | null {
  if (!config.autoReply?.enabled || !config.autoReply.templates.length) {
    return null;
  }

  const templates: AutoReplyTemplate[] = config.autoReply.templates.map((template) => ({
    id: template.id,
    trigger: template.trigger as AutoReplyTemplate["trigger"],
    response: template.response,
    priority: template.priority,
    cooldown: template.cooldown,
    once: template.once,
    channels: template.channels,
    chatTypes: template.chatTypes,
    forwardToAi: template.forwardToAi,
  }));
  const engine = new TemplateEngine(templates);
  logger.info({ count: templates.length }, "Auto-reply templates loaded");
  return engine;
}
