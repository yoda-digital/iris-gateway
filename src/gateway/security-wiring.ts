import type { IrisConfig } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import { SecurityGate } from "../security/dm-policy.js";
import { PairingStore } from "../security/pairing-store.js";
import { AllowlistStore } from "../security/allowlist-store.js";
import { RateLimiter } from "../security/rate-limiter.js";

export interface SecurityComponents {
  pairingStore: PairingStore;
  allowlistStore: AllowlistStore;
  rateLimiter: RateLimiter;
  securityGate: SecurityGate;
}

/**
 * Initialize security gate, pairing store, allowlist, and rate limiter.
 */
export function initSecurity(config: IrisConfig, stateDir: string): SecurityComponents {
  const pairingStore = new PairingStore(
    stateDir,
    config.security.pairingCodeTtlMs,
    config.security.pairingCodeLength,
  );
  const allowlistStore = new AllowlistStore(stateDir);
  const rateLimiter = new RateLimiter({
    perMinute: config.security.rateLimitPerMinute,
    perHour: config.security.rateLimitPerHour,
  });
  const securityGate = new SecurityGate(pairingStore, allowlistStore, rateLimiter, config.security);

  return { pairingStore, allowlistStore, rateLimiter, securityGate };
}
