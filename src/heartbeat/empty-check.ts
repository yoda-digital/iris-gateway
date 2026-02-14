import { createHash } from "node:crypto";
import type { HealthStatus } from "./types.js";

export interface EmptyCheckState {
  previousHash: string;
  consecutiveEmpty: number;
}

export function hashStatuses(statuses: Array<{ component: string; status: HealthStatus }>): string {
  const sorted = [...statuses].sort((a, b) => a.component.localeCompare(b.component));
  const input = sorted.map((s) => `${s.component}:${s.status}`).join("|");
  return createHash("md5").update(input).digest("hex");
}

export function shouldSkipEmptyCheck(
  enabled: boolean,
  state: EmptyCheckState,
  currentHash: string,
): boolean {
  if (!enabled) return false;

  if (currentHash !== state.previousHash) {
    state.previousHash = currentHash;
    state.consecutiveEmpty = 0;
    return false;
  }

  state.consecutiveEmpty++;
  return true;
}

export function computeBackoffInterval(
  baseMs: number,
  consecutiveEmpty: number,
  maxBackoffMs: number,
): number {
  if (maxBackoffMs <= 0 || consecutiveEmpty === 0) return baseMs;
  const backed = baseMs * Math.pow(2, consecutiveEmpty);
  return Math.min(backed, maxBackoffMs);
}
