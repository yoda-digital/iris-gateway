import { describe, it, expect } from "vitest";
import { MessageRouter } from "../../src/bridge/message-router.js";
import { SessionMap } from "../../src/bridge/session-map.js";
import { SecurityGate } from "../../src/security/dm-policy.js";
import { PairingStore } from "../../src/security/pairing-store.js";
import { AllowlistStore } from "../../src/security/allowlist-store.js";
import { RateLimiter } from "../../src/security/rate-limiter.js";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { MockOpenCodeBridge } from "../helpers/mock-opencode.js";
import pino from "pino";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("debug selectAgent", () => {
  it("direct call test", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "iris-debug-"));
    const bridge = new MockOpenCodeBridge();
    const sessionMap = new SessionMap(tempDir);
    const pairingStore = new PairingStore(tempDir);
    const allowlistStore = new AllowlistStore(tempDir);
    const rateLimiter = new RateLimiter();
    const gate = new SecurityGate(pairingStore, allowlistStore, rateLimiter);
    const registry = new ChannelRegistry();
    const logger = pino({ level: "silent" });
    const router = new MessageRouter(bridge as any, sessionMap, gate, registry, logger);
    
    // Try calling function directly (not bound)
    const fn = MessageRouter.prototype.selectAgent;
    const result = fn.call(router, "fix", "telegram");
    console.log("prototype call result:", result);
    
    // Check if channelConfigs[telegram] has a defaultAgent  
    const cc = (router as any).channelConfigs;
    console.log("channelConfigs telegram:", JSON.stringify(cc["telegram"]));
    console.log("defaultAgent:", cc["telegram"]?.defaultAgent);
    
    expect(result).toBe("build");
  });
});
