import { describe, it, expect } from "vitest";
import { irisConfigSchema, parseConfig } from "../../src/config/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const safeParse = (input: unknown) => irisConfigSchema.safeParse(input);

// ---------------------------------------------------------------------------
// 1. Top-level defaults
// ---------------------------------------------------------------------------
describe("irisConfigSchema — top-level defaults", () => {
  it("empty object produces valid config with all defaults", () => {
    const result = safeParse({});
    expect(result.success).toBe(true);
  });

  it("gateway defaults: port=19876, hostname=127.0.0.1", () => {
    const cfg = parseConfig({});
    expect(cfg.gateway.port).toBe(19876);
    expect(cfg.gateway.hostname).toBe("127.0.0.1");
  });

  it("security defaults: defaultDmPolicy=pairing, rateLimitPerMinute=30", () => {
    const cfg = parseConfig({});
    expect(cfg.security.defaultDmPolicy).toBe("pairing");
    expect(cfg.security.rateLimitPerMinute).toBe(30);
    expect(cfg.security.rateLimitPerHour).toBe(300);
    expect(cfg.security.pairingCodeLength).toBe(8);
  });

  it("opencode defaults: port=4096, autoSpawn=true", () => {
    const cfg = parseConfig({});
    expect(cfg.opencode.port).toBe(4096);
    expect(cfg.opencode.autoSpawn).toBe(true);
    expect(cfg.opencode.hostname).toBe("127.0.0.1");
  });

  it("logging defaults: level=info", () => {
    const cfg = parseConfig({});
    expect(cfg.logging.level).toBe("info");
  });

  it("governance defaults: enabled=false, rules=[], directives=[]", () => {
    const cfg = parseConfig({});
    expect(cfg.governance.enabled).toBe(false);
    expect(cfg.governance.rules).toEqual([]);
    expect(cfg.governance.directives).toEqual([]);
  });

  it("mcp defaults: enabled=false, servers={}", () => {
    const cfg = parseConfig({});
    expect(cfg.mcp.enabled).toBe(false);
    expect(cfg.mcp.servers).toEqual({});
  });

  it("channels defaults to empty record", () => {
    const cfg = parseConfig({});
    expect(cfg.channels).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 2. Valid config passthrough
// ---------------------------------------------------------------------------
describe("irisConfigSchema — valid full configs", () => {
  it("accepts a telegram channel with token", () => {
    const result = safeParse({
      channels: {
        tg: { type: "telegram", enabled: true, token: "bot123:ABC" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts discord channel with botToken", () => {
    const result = safeParse({
      channels: {
        dc: { type: "discord", enabled: true, botToken: "disc-token" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts custom gateway port and hostname", () => {
    const cfg = parseConfig({ gateway: { port: 8888, hostname: "0.0.0.0" } });
    expect(cfg.gateway.port).toBe(8888);
    expect(cfg.gateway.hostname).toBe("0.0.0.0");
  });

  it("accepts logging level=debug", () => {
    const cfg = parseConfig({ logging: { level: "debug" } });
    expect(cfg.logging.level).toBe("debug");
  });

  it("accepts a valid cron entry", () => {
    const cfg = parseConfig({
      cron: [
        {
          name: "daily-briefing",
          schedule: "0 9 * * *",
          prompt: "Give me a morning briefing",
          channel: "telegram",
          chatId: "123456",
        },
      ],
    });
    expect(cfg.cron).toHaveLength(1);
    expect(cfg.cron![0].name).toBe("daily-briefing");
  });
});

// ---------------------------------------------------------------------------
// 3. Missing required fields fail
// ---------------------------------------------------------------------------
describe("irisConfigSchema — missing required fields", () => {
  it("channel without type fails", () => {
    const result = safeParse({
      channels: { tg: { enabled: true } },
    });
    expect(result.success).toBe(false);
  });

  it("cron entry missing prompt fails", () => {
    const result = safeParse({
      cron: [{ name: "x", schedule: "* * * * *", channel: "tg", chatId: "1" }],
    });
    expect(result.success).toBe(false);
  });

  it("cron entry missing schedule fails", () => {
    const result = safeParse({
      cron: [{ name: "x", prompt: "hi", channel: "tg", chatId: "1" }],
    });
    expect(result.success).toBe(false);
  });

  it("governance rule missing id fails", () => {
    const result = safeParse({
      governance: {
        enabled: true,
        rules: [{ description: "no id", tool: "bash", type: "audit" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("governance rule missing tool fails", () => {
    const result = safeParse({
      governance: {
        enabled: true,
        rules: [{ id: "r1", type: "audit" }],
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Invalid types fail
// ---------------------------------------------------------------------------
describe("irisConfigSchema — invalid types", () => {
  it("gateway port as string fails", () => {
    const result = safeParse({ gateway: { port: "abc" } });
    expect(result.success).toBe(false);
  });

  it("security.rateLimitPerMinute as float fails", () => {
    const result = safeParse({ security: { rateLimitPerMinute: 1.5 } });
    expect(result.success).toBe(false);
  });

  it("security.pairingCodeLength below 4 fails", () => {
    const result = safeParse({ security: { pairingCodeLength: 3 } });
    expect(result.success).toBe(false);
  });

  it("security.pairingCodeLength above 16 fails", () => {
    const result = safeParse({ security: { pairingCodeLength: 17 } });
    expect(result.success).toBe(false);
  });

  it("logging.level with invalid enum fails", () => {
    const result = safeParse({ logging: { level: "verbose" } });
    expect(result.success).toBe(false);
  });

  it("channel type with invalid enum fails", () => {
    const result = safeParse({
      channels: { x: { type: "matrix", enabled: true } },
    });
    expect(result.success).toBe(false);
  });

  it("dmPolicy with invalid value fails", () => {
    const result = safeParse({
      channels: { tg: { type: "telegram", dmPolicy: "everyone" } },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Heartbeat schema
// ---------------------------------------------------------------------------
describe("heartbeatSchema", () => {
  it("heartbeat enabled with minimal config", () => {
    const cfg = parseConfig({ heartbeat: { enabled: true } });
    expect(cfg.heartbeat?.enabled).toBe(true);
    expect(cfg.heartbeat?.intervals.healthy).toBe(60_000);
    expect(cfg.heartbeat?.intervals.degraded).toBe(15_000);
    expect(cfg.heartbeat?.logRetentionDays).toBe(30);
  });

  it("heartbeat activeHours with invalid time format fails", () => {
    const result = safeParse({
      heartbeat: {
        enabled: true,
        activeHours: { start: "9am", end: "17:00", timezone: "UTC" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("heartbeat activeHours with valid HH:MM passes", () => {
    const result = safeParse({
      heartbeat: {
        enabled: true,
        activeHours: { start: "09:00", end: "17:00", timezone: "Europe/Chisinau" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("heartbeat selfHeal maxAttempts default = 3", () => {
    const cfg = parseConfig({ heartbeat: { enabled: true } });
    expect(cfg.heartbeat?.selfHeal.maxAttempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 6. Proactive schema
// ---------------------------------------------------------------------------
describe("proactiveSchema", () => {
  it("proactive enabled with defaults", () => {
    const cfg = parseConfig({ proactive: { enabled: true } });
    expect(cfg.proactive?.enabled).toBe(true);
    expect(cfg.proactive?.pollIntervalMs).toBe(60_000);
    expect(cfg.proactive?.softQuotas.perUserPerDay).toBe(3);
    expect(cfg.proactive?.quietHours.start).toBe(22);
    expect(cfg.proactive?.quietHours.end).toBe(8);
  });

  it("proactive quietHours start outside 0-23 fails", () => {
    const result = safeParse({
      proactive: { enabled: true, quietHours: { start: 25, end: 8 } },
    });
    expect(result.success).toBe(false);
  });

  it("proactive intentDefaults confidence 0-1 range validated", () => {
    const result = safeParse({
      proactive: {
        enabled: true,
        intentDefaults: { defaultConfidence: 1.5 },
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Policy schema
// ---------------------------------------------------------------------------
describe("policySchema", () => {
  it("policy disabled by default", () => {
    const cfg = parseConfig({});
    expect(cfg.policy.enabled).toBe(false);
  });

  it("policy bash permission default = deny", () => {
    const cfg = parseConfig({});
    expect(cfg.policy.permissions.bash).toBe("deny");
  });

  it("policy tools allowed/denied default to empty arrays", () => {
    const cfg = parseConfig({});
    expect(cfg.policy.tools.allowed).toEqual([]);
    expect(cfg.policy.tools.denied).toEqual([]);
  });

  it("policy agents maxSteps default = 0", () => {
    const cfg = parseConfig({});
    expect(cfg.policy.agents.maxSteps).toBe(0);
  });

  it("policy enforcement blockUnknownTools default = true", () => {
    const cfg = parseConfig({});
    expect(cfg.policy.enforcement.blockUnknownTools).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. CLI schema
// ---------------------------------------------------------------------------
describe("cliSchema", () => {
  it("cli optional — absent by default", () => {
    const cfg = parseConfig({});
    expect(cfg.cli).toBeUndefined();
  });

  it("cli enabled with tool definition", () => {
    const cfg = parseConfig({
      cli: {
        enabled: true,
        tools: {
          gh: {
            binary: "gh",
            description: "GitHub CLI",
            actions: {
              list: { subcommand: ["issue", "list"] },
            },
          },
        },
      },
    });
    expect(cfg.cli?.enabled).toBe(true);
    expect(cfg.cli?.tools["gh"].binary).toBe("gh");
  });

  it("cli tool with empty binary fails", () => {
    const result = safeParse({
      cli: {
        enabled: true,
        tools: {
          bad: { binary: "", description: "test", actions: {} },
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Edge cases
// ---------------------------------------------------------------------------
describe("irisConfigSchema — edge cases", () => {
  it("empty string model IDs in channel token are accepted (optional)", () => {
    // token is optional — empty string still passes string type check
    const result = safeParse({
      channels: { tg: { type: "telegram", enabled: true, token: "" } },
    });
    expect(result.success).toBe(true);
  });

  it("plugins array accepted", () => {
    const cfg = parseConfig({ plugins: ["vault-brain", "proactive"] });
    expect(cfg.plugins).toEqual(["vault-brain", "proactive"]);
  });

  it("canvas optional, absent by default", () => {
    const cfg = parseConfig({});
    expect(cfg.canvas).toBeUndefined();
  });

  it("canvas with defaults", () => {
    const cfg = parseConfig({ canvas: { enabled: true } });
    expect(cfg.canvas?.port).toBe(19880);
    expect(cfg.canvas?.hostname).toBe("127.0.0.1");
  });

  it("onboarding optional, enricher enabled by default when present", () => {
    const cfg = parseConfig({ onboarding: { enabled: true } });
    expect(cfg.onboarding?.enricher.enabled).toBe(true);
    expect(cfg.onboarding?.enricher.signalRetentionDays).toBe(90);
  });

  it("mcp servers record accepts multiple entries", () => {
    const cfg = parseConfig({
      mcp: {
        enabled: true,
        servers: {
          "server-a": { enabled: true },
          "server-b": { enabled: false },
        },
      },
    });
    expect(Object.keys(cfg.mcp.servers)).toHaveLength(2);
    expect(cfg.mcp.servers["server-a"].enabled).toBe(true);
  });
});
