/**
 * model-sync.ts — Single-responsibility module for syncing iris.config.json
 * models to opencode.json and agent frontmatter.
 *
 * Extracted from lifecycle.ts to satisfy the VISION.md 500-line hard limit.
 */

import { join } from "node:path";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import type { IrisConfig } from "./types.js";
import type { OpenCodeConfig } from "./types.js";
import type { Logger } from "../logging/logger.js";

/**
 * Syncs iris.config.json model configuration into opencode.json and agent
 * frontmatter files. Returns `true` if opencode.json was modified.
 *
 * Responsibilities:
 * 1. Sync `models.primary` / `models.small` → opencode.json top-level fields
 * 2. Auto-register unknown OpenRouter models via the OpenRouter /models API
 * 3. Sync `models.primary` into `.opencode/agent/*.md` frontmatter
 */
export async function syncModelsToOpenCode(
  config: IrisConfig,
  ocConfig: OpenCodeConfig,
  logger: Logger,
): Promise<boolean> {
  if (!config.models || typeof config.models !== "object") return false;

  const ocPath = join(ocConfig.projectDir ?? process.cwd(), ".opencode", "opencode.json");
  let ocJson: Record<string, unknown>;
  try {
    ocJson = JSON.parse(readFileSync(ocPath, "utf-8"));
  } catch (err) {
    logger.warn({ err }, "Could not sync models to opencode.json");
    return false;
  }

  let changed = false;
  const models = config.models as Record<string, string>;

  // 1. Sync primary / small model fields
  if (models.primary && ocJson.model !== models.primary) {
    ocJson.model = models.primary;
    changed = true;
  }
  if (models.small && ocJson.small_model !== models.small) {
    ocJson.small_model = models.small;
    changed = true;
  }

  // 2. Auto-register unknown OpenRouter models
  // OpenCode silently fails on unknown models — no tool calls, empty responses.
  // We query the OpenRouter /models API to get real capabilities (context window, etc.)
  // and register each model correctly. Falls back to safe defaults if API unreachable.
  const newModels = [models.primary, models.small].filter(Boolean) as string[];
  for (const modelId of newModels) {
    const orPrefix = "openrouter/";
    if (!modelId.startsWith(orPrefix)) continue;
    const orModelId = modelId.slice(orPrefix.length);

    const providerModels =
      (ocJson.provider as Record<string, unknown> | undefined)?.openrouter as
        | Record<string, unknown>
        | undefined;
    const existingModels = (providerModels?.models ?? {}) as Record<string, unknown>;

    if (!existingModels[orModelId]) {
      // Query OpenRouter for real model capabilities
      let contextWindow = 131072;
      let maxOutput = 16384;
      let supportsTools = true;
      let modelName = orModelId;

      try {
        const apiKey = process.env["OPENROUTER_API_KEY"];
        if (apiKey) {
          const resp = await fetch(
            `https://openrouter.ai/api/v1/models/${encodeURIComponent(orModelId)}`,
            { headers: { Authorization: `Bearer ${apiKey}` } },
          );
          if (resp.ok) {
            const data = (await resp.json()) as Record<string, unknown>;
            if (typeof data.context_length === "number") contextWindow = data.context_length;
            const topProvider = data.top_provider as Record<string, unknown> | undefined;
            if (typeof topProvider?.max_completion_tokens === "number") {
              maxOutput = topProvider.max_completion_tokens;
            }
            if (Array.isArray(data.supported_parameters)) {
              supportsTools = (data.supported_parameters as string[]).includes("tools");
            }
            if (typeof data.name === "string") modelName = data.name;
            logger.info(
              { contextWindow, maxOutput, supportsTools },
              `Fetched capabilities for ${orModelId} from OpenRouter`,
            );
          }
        }
      } catch (err) {
        logger.warn({ err }, "Failed to fetch model capabilities from OpenRouter API — using safe defaults");
      }

      const entry: Record<string, unknown> = {
        name: modelName,
        attachment: true,
        tool_call: supportsTools,
        limit: { context: contextWindow, output: maxOutput },
      };
      // Note: interleaved/reasoning flags are intentionally NOT set here.
      // They are model-specific (e.g. DeepSeek-R1 reasoning_content) and must be
      // configured manually — wrong flags cause silent hang waiting for a field that never arrives.

      ocJson.provider ??= {};
      const provider = ocJson.provider as Record<string, any>;
      provider.openrouter ??= { options: { baseURL: "https://openrouter.ai/api/v1" }, models: {} };
      const openrouterSection = provider.openrouter as Record<string, unknown>;
      if (!openrouterSection.models) openrouterSection.models = {};
      (openrouterSection.models as Record<string, unknown>)[orModelId] = entry;
      changed = true;
      logger.info(
        { contextWindow, maxOutput, supportsTools },
        `Registered model in opencode.json: ${orModelId}`,
      );
    }
  }

  // Write opencode.json if changed
  if (changed) {
    try {
      writeFileSync(ocPath, JSON.stringify(ocJson, null, 2));
    } catch (writeErr) {
      logger.warn({ err: writeErr }, "Could not write opencode.json — model sync changes not persisted");
    }
    logger.info(
      { model: ocJson.model, small_model: ocJson.small_model },
      "Synced models from iris.config.json to opencode.json",
    );
  }

  // 3. Sync primary model into agent frontmatter
  // agent model: overrides opencode.json — must be kept in sync
  if (models.primary) {
    const agentDir = join(ocConfig.projectDir ?? process.cwd(), ".opencode", "agent");
    try {
      const agentFiles = readdirSync(agentDir).filter((f: string) => f.endsWith(".md"));
      for (const file of agentFiles) {
        const agentPath = join(agentDir, file);
        const content = readFileSync(agentPath, "utf-8");
        if (content.startsWith("---") && /^model:/m.test(content)) {
          const updated = content.replace(/^(model:\s*)(.+)$/m, `$1${models.primary}`);
          if (updated !== content) {
            writeFileSync(agentPath, updated);
            logger.info({ model: models.primary }, `Synced model in .opencode/agent/${file}`);
          }
        }
      }
    } catch {
      /* agent dir may not exist — skip */
    }
  }

  const finalModel = models.primary ?? (ocJson.model as string | undefined) ?? "unknown";
  console.log(`\n  ✔ Model: ${finalModel}\n`);

  return changed;
}
