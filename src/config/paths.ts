import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getStateDir(): string {
  return process.env["IRIS_STATE_DIR"] ?? join(homedir(), ".iris");
}

export function getConfigPath(): string {
  return process.env["IRIS_CONFIG_PATH"] ?? "iris.config.json";
}

export function ensureDir(dirPath: string): string {
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}
