import { spawnSync } from "node:child_process";

export interface OpenCodeInfo {
  /** Full path to the opencode binary */
  path: string;
  /** Version string (e.g., "1.2.3") */
  version: string;
}

/**
 * Detects if OpenCode CLI is available in PATH.
 * Checks for both "opencode" and "opencode-ai" binaries.
 * @returns OpenCodeInfo if found, null otherwise
 */
export function detectOpenCode(): OpenCodeInfo | null {
  for (const bin of ["opencode", "opencode-ai"]) {
    try {
      // Check if binary exists in PATH
      const whichResult = spawnSync("which", [bin], { encoding: "utf-8" });
      if (whichResult.status !== 0 || !whichResult.stdout.trim()) {
        continue;
      }

      const path = whichResult.stdout.trim();

      // Get version
      const versionResult = spawnSync(bin, ["--version"], { encoding: "utf-8" });
      const version = versionResult.status === 0 && versionResult.stdout.trim()
        ? versionResult.stdout.trim()
        : "unknown";

      return { path, version };
    } catch {
      // Ignore errors and try next binary
    }
  }

  return null;
}

/**
 * Installs OpenCode CLI globally using npm.
 * @returns true if installation succeeded, false otherwise
 */
export function installOpenCode(): boolean {
  try {
    const result = spawnSync("npm", ["install", "-g", "opencode-ai"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}
