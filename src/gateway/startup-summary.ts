import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { IrisConfig } from "../config/types.js";
import type { GovernanceEngine } from "../governance/engine.js";

/**
 * Prints a startup summary box to stdout after the gateway is fully ready.
 */
export function printStartupSummary(config: IrisConfig, governanceEngine: GovernanceEngine): void {
  try {
    const ocPath = join(config.opencode.projectDir ?? process.cwd(), ".opencode", "opencode.json");
    const ocConfig = JSON.parse(readFileSync(ocPath, "utf-8"));
    const primaryModel = ocConfig.model ?? "unknown";
    const smallModel = ocConfig.small_model ?? "none";
    const channels = Object.keys(config.channels);
    const securityMode = config.security?.defaultDmPolicy ?? "open";
    const governanceRules = governanceEngine?.getRules?.()?.length ?? 0;

    console.log("");
    console.log("  ┌─────────────────────────────────────────┐");
    console.log("  │             Gateway Ready                │");
    console.log("  ├─────────────────────────────────────────┤");
    console.log(`  │  Model:     ${primaryModel.padEnd(28)}│`);
    console.log(`  │  Small:     ${smallModel.padEnd(28)}│`);
    console.log(`  │  Channels:  ${channels.join(", ").padEnd(28)}│`);
    console.log(`  │  Security:  ${securityMode.padEnd(28)}│`);
    console.log(`  │  Rules:     ${String(governanceRules).padEnd(28)}│`);
    console.log(`  │  OpenCode:  :${config.opencode.port}${"".padEnd(23)}│`);
    console.log(`  │  Tools:     :19877${"".padEnd(22)}│`);
    console.log(`  │  Health:    :19876${"".padEnd(22)}│`);
    console.log("  └─────────────────────────────────────────┘");
    console.log("");
  } catch { /* Best-effort */ }
}
