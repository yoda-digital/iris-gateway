import type { DmPolicyMode, SecurityConfig } from "../config/types.js";
import type { AllowlistStore } from "./allowlist-store.js";
import type { PairingStore } from "./pairing-store.js";
import type { RateLimiter } from "./rate-limiter.js";

export interface SecurityCheckParams {
  readonly channelId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly chatType: "dm" | "group";
  readonly channelDmPolicy?: DmPolicyMode;
}

export type SecurityCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "disabled" | "not_allowed" | "rate_limited";
      message?: string;
    }
  | {
      allowed: false;
      reason: "pairing_required";
      pairingCode: string;
      message: string;
    };

export class SecurityGate {
  constructor(
    private readonly pairingStore: PairingStore,
    private readonly allowlistStore: AllowlistStore,
    private readonly rateLimiter: RateLimiter,
    private readonly config: SecurityConfig,
  ) {}

  async check(params: SecurityCheckParams): Promise<SecurityCheckResult> {
    const policy =
      params.channelDmPolicy ?? this.config.defaultDmPolicy;

    // Rate limit check (applies to all modes except disabled)
    if (policy !== "disabled") {
      const rateLimitKey = `${params.channelId}:${params.senderId}`;
      const rateResult = this.rateLimiter.check(rateLimitKey);
      if (!rateResult.allowed) {
        return {
          allowed: false,
          reason: "rate_limited",
          message: `Rate limited. Try again in ${Math.ceil((rateResult.retryAfterMs ?? 0) / 1000)}s.`,
        };
      }
      this.rateLimiter.hit(rateLimitKey);
    }

    switch (policy) {
      case "open":
        return { allowed: true };

      case "disabled":
        return {
          allowed: false,
          reason: "disabled",
          message: "This channel is currently disabled.",
        };

      case "allowlist": {
        const isAllowed = await this.allowlistStore.isAllowed(
          params.channelId,
          params.senderId,
        );
        if (isAllowed) return { allowed: true };
        return {
          allowed: false,
          reason: "not_allowed",
          message: "You are not on the allowlist for this channel.",
        };
      }

      case "pairing": {
        const isAllowed = await this.allowlistStore.isAllowed(
          params.channelId,
          params.senderId,
        );
        if (isAllowed) return { allowed: true };

        const code = await this.pairingStore.issueCode(
          params.channelId,
          params.senderId,
        );
        return {
          allowed: false,
          reason: "pairing_required",
          pairingCode: code,
          message: `Hi ${params.senderName}! To start chatting, ask the owner to approve your pairing code: ${code}`,
        };
      }

      default:
        return {
          allowed: false,
          reason: "disabled",
          message: "Unknown policy mode.",
        };
    }
  }
}
