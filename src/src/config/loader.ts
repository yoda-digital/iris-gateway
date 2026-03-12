import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IrisConfig } from "./types.js";
import { getConfigPath } from "./paths.js";
import { parseConfig } from "./schema.js";

const ENV_PATTERN = /\$\{env:([A-Z_][A-Z0-9_]*)\}/g;

export function substituteEnv(raw: string): string {
  return raw.replace(ENV_PATTERN, (match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`Missing environment variable: ${varName} (referenced as ${match})`);
    }
    return value;
  });
}

export function loadConfig(path?: string): IrisConfig {
  const configPath = resolve(path ?? getConfigPath());

  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return parseConfig({});
    }
    throw err;
  }

  const substituted = substituteEnv(content);
  const raw = JSON.parse(substituted) as unknown;
  return parseConfig(raw);
}
