#!/usr/bin/env node
/**
 * Postinstall script: checks for OpenCode CLI availability and optionally installs it.
 *
 * Behavior (in order of precedence):
 * 1. If IRIS_INSTALL_OPENCODE=1 or IRIS_INSTALL_OPENCODE=true → auto-install without prompting
 * 2. If IRIS_INSTALL_OPENCODE=0 or IRIS_INSTALL_OPENCODE=false → skip check entirely
 * 3. If stdin is not a TTY (CI/Docker/piped) → check only, log warning if missing
 * 4. Otherwise → interactive prompt asking user to install
 *
 * This script runs after `npm install` / `pnpm install` via the "postinstall" hook.
 * Failures are non-fatal — the gateway can still run without OpenCode.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Detection ───────────────────────────────────────────────────────────────

export interface OpenCodeInfo {
  path: string;
  version: string;
}

export function detectOpenCode(): OpenCodeInfo | null {
  for (const bin of ["opencode", "opencode-ai"]) {
    try {
      const whichResult = spawnSync("which", [bin], { encoding: "utf-8" });
      if (whichResult.status !== 0 || !whichResult.stdout.trim()) {
        continue;
      }

      const path = whichResult.stdout.trim();
      const versionResult = spawnSync(bin, ["--version"], { encoding: "utf-8" });
      const version =
        versionResult.status === 0 && versionResult.stdout.trim()
          ? versionResult.stdout.trim()
          : "unknown";

      return { path, version };
    } catch {
      // Ignore errors and try next binary
    }
  }

  return null;
}

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

// ─── Logging helpers ─────────────────────────────────────────────────────────

const CHECKMARK = "✅";
const WARNING = "⚠️ ";
const CROSS = "❌";

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`  ${message}`);
}

// ─── Main logic ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const envValue = process.env.IRIS_INSTALL_OPENCODE?.toLowerCase();

  // IRIS_INSTALL_OPENCODE=0/false → skip entirely
  if (envValue === "0" || envValue === "false") {
    return;
  }

  const ocInfo = detectOpenCode();

  if (ocInfo) {
    log(`${CHECKMARK} opencode v${ocInfo.version} (${ocInfo.path})`);
    return;
  }

  // OpenCode not found
  log(`${WARNING} opencode not found in PATH`);

  const autoInstall = envValue === "1" || envValue === "true";
  const isTTY = process.stdin.isTTY;

  // CI / non-interactive → log warning and exit
  if (!isTTY && !autoInstall) {
    log(`${WARNING} Install manually: npm install -g opencode-ai`);
    return;
  }

  // Auto-install via env/flag
  if (autoInstall) {
    log("Installing opencode-ai globally...");
    const success = installOpenCode();
    if (success) {
      log(`${CHECKMARK} opencode installed successfully`);
    } else {
      log(`${CROSS} Failed to install opencode-ai — run manually: npm install -g opencode-ai`);
    }
    return;
  }

  // Interactive prompt
  log("");
  log("OpenCode CLI is recommended for coding agent features.");
  log("Install now? (y/N)");

  // Read one line from stdin
  const answer = await readLineAsync();
  if (answer?.trim().toLowerCase() === "y" || answer?.trim().toLowerCase() === "yes") {
    log("Installing opencode-ai globally...");
    const success = installOpenCode();
    if (success) {
      log(`${CHECKMARK} opencode installed successfully`);
    } else {
      log(`${CROSS} Failed to install — run manually: npm install -g opencode-ai`);
    }
  } else {
    log("Skipped. Install later with: npm install -g opencode-ai");
  }
}

function readLineAsync(): Promise<string | null> {
  return new Promise((resolve) => {
    // Set a 10-second timeout to avoid hanging
    const timeoutId = setTimeout(() => {
      process.stdin.pause();
      resolve(null);
    }, 10_000);

    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (chunk: Buffer) => {
      clearTimeout(timeoutId);
      process.stdin.pause();
      resolve(chunk.toString().trim());
    });
  });
}

// Run the script only when executed directly (not when imported for testing)
// In ESM, we check if import.meta.url matches the file: URL of this script
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("postinstall.ts") ||
    process.argv[1].endsWith("postinstall.js"));

if (isMainModule) {
  main().catch(() => {
    // Silently ignore — postinstall failures must not break npm install
  });
}
