import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageRouter } from "../../src/bridge/message-router.js";
import { SessionMap } from "../../src/bridge/session-map.js";
import { SecurityGate } from "../../src/security/dm-policy.js";
import { PairingStore } from "../../src/security/pairing-store.js";
import { AllowlistStore } from "../../src/security/allowlist-store.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { CircuitBreaker } from "../../src/bridge/circuit-breaker.js";
import { TemplateEngine } from "../../src/auto-reply/engine.js";
import { MockAdapter } from "./mock-adapter.js";
import { MockOpenCodeBridge } from "./mock-opencode.js";
import pino from "pino";

export class ControllableBridge extends MockOpenCodeBridge {
  readonly _cb = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 10_000 });
  override getCircuitBreaker() { return this._cb; }
}

export interface EnvOptions {
  withAdapter?: boolean;
  dmPolicy?: "open" | "disabled" | "allowlist" | "pairing";
  channelConfigs?: Record<string, any>;
  templateEngine?: TemplateEngine | null;
  profileEnricher?: { isFirstContact(profile: any): boolean } | null;
  vaultStoreRef?: { getProfile(senderId: string, channelId: string): any } | null;
}

export function makeEnv(opts: EnvOptions = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "iris-branches-"));
  writeFileSync(join(tempDir, "pairing.json"), "[]");
  writeFileSync(join(tempDir, "allowlist.json"), "[]");

  const bridge = new ControllableBridge();
  const sessionMap = new SessionMap(tempDir);
  const securityGate = new SecurityGate(
    new PairingStore(tempDir),
    new AllowlistStore(tempDir),
    new RateLimiter({ perMinute: 30, perHour: 300 }),
    {
      defaultDmPolicy: opts.dmPolicy ?? "open",
      pairingCodeTtlMs: 3_600_000,
      pairingCodeLength: 8,
      rateLimitPerMinute: 30,
      rateLimitPerHour: 300,
    },
  );

  const registry = new ChannelRegistry();
  const adapter = new MockAdapter("mock", "Mock Channel", { edit: opts.channelConfigs?.mock?.streaming?.editInPlace ?? false });
  if (opts.withAdapter !== false) registry.register(adapter);

  const logger = pino({ level: "silent" });

  const router = new MessageRouter(
    bridge as any,
    sessionMap,
    securityGate,
    registry,
    logger,
    opts.channelConfigs ?? {},
    opts.templateEngine,
    null,
    opts.profileEnricher,
    opts.vaultStoreRef,
  );

  return { tempDir, bridge, adapter, router, registry };
}

export function cleanup(tempDir: string) {
  rmSync(tempDir, { recursive: true, force: true });
}
