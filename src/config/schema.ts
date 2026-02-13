import { z } from "zod";
import type { IrisConfig } from "./types.js";

const dmPolicySchema = z.enum(["open", "pairing", "allowlist", "disabled"]);

const groupPolicySchema = z.object({
  enabled: z.boolean().default(false),
  requireMention: z.boolean().default(true),
  allowedCommands: z.array(z.string()).optional(),
});

const streamingSchema = z.object({
  enabled: z.boolean().default(false),
  minChars: z.number().positive().optional(),
  maxChars: z.number().positive().optional(),
  idleMs: z.number().positive().optional(),
  breakOn: z.enum(["paragraph", "sentence", "word"]).optional(),
  editInPlace: z.boolean().optional(),
});

const channelAccountSchema = z.object({
  type: z.enum(["telegram", "whatsapp", "discord", "slack", "webchat"]),
  enabled: z.boolean().default(false),
  token: z.string().optional(),
  appToken: z.string().optional(),
  botToken: z.string().optional(),
  dmPolicy: dmPolicySchema.optional(),
  groupPolicy: groupPolicySchema.optional(),
  mentionPattern: z.string().optional(),
  maxTextLength: z.number().positive().optional(),
  streaming: streamingSchema.optional(),
});

const gatewaySchema = z.object({
  port: z.number().int().positive().default(19876),
  hostname: z.string().default("127.0.0.1"),
});

const securitySchema = z.object({
  defaultDmPolicy: dmPolicySchema.default("pairing"),
  pairingCodeTtlMs: z.number().positive().default(3_600_000),
  pairingCodeLength: z.number().int().min(4).max(16).default(8),
  rateLimitPerMinute: z.number().int().positive().default(30),
  rateLimitPerHour: z.number().int().positive().default(300),
});

const openCodeSchema = z.object({
  port: z.number().int().positive().default(4096),
  hostname: z.string().default("127.0.0.1"),
  autoSpawn: z.boolean().default(true),
  projectDir: z.string().optional(),
});

const cronJobSchema = z.object({
  name: z.string().min(1),
  schedule: z.string().min(1),
  prompt: z.string().min(1),
  channel: z.string().min(1),
  chatId: z.string().min(1),
});

const loggingSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  file: z.string().optional(),
  json: z.boolean().optional(),
});

const governanceRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().default(""),
  tool: z.string().min(1),
  type: z.enum(["rate_limit", "constraint", "custom", "audit"]),
  params: z.record(z.unknown()).default({}),
});

const governanceSchema = z.object({
  enabled: z.boolean().default(false),
  rules: z.array(governanceRuleSchema).default([]),
  directives: z.array(z.string()).default([]),
});

const mcpServerSchema = z.object({
  enabled: z.boolean().default(true),
});

const mcpSchema = z.object({
  enabled: z.boolean().default(false),
  servers: z.record(z.string(), mcpServerSchema).default({}),
});

const policySchema = z.object({
  enabled: z.boolean().default(false),
  tools: z.object({
    allowed: z.array(z.string()).default([]),
    denied: z.array(z.string()).default([]),
  }).default({}),
  permissions: z.object({
    bash: z.enum(["allow", "deny"]).default("deny"),
    edit: z.enum(["allow", "deny"]).default("deny"),
    read: z.enum(["allow", "deny"]).default("deny"),
  }).default({}),
  agents: z.object({
    allowedModes: z.array(z.string()).default(["subagent"]),
    maxSteps: z.number().int().min(0).default(0),
    requireDescription: z.boolean().default(true),
    defaultTools: z.array(z.string()).default(["vault_search", "skill"]),
    allowPrimaryCreation: z.boolean().default(false),
  }).default({}),
  skills: z.object({
    restricted: z.array(z.string()).default([]),
    requireTriggers: z.boolean().default(false),
  }).default({}),
  enforcement: z.object({
    blockUnknownTools: z.boolean().default(true),
    auditPolicyViolations: z.boolean().default(true),
  }).default({}),
}).default({});

const proactiveSchema = z.object({
  enabled: z.boolean().default(false),
  pollIntervalMs: z.number().positive().default(60_000),
  passiveScanIntervalMs: z.number().positive().default(21_600_000),
  softQuotas: z.object({
    perUserPerDay: z.number().int().positive().default(3),
    globalPerDay: z.number().int().positive().default(100),
  }).default({}),
  dormancy: z.object({
    enabled: z.boolean().default(true),
    thresholdMs: z.number().positive().default(604_800_000),
  }).default({}),
  intentDefaults: z.object({
    minDelayMs: z.number().positive().default(3_600_000),
    maxAgeMs: z.number().positive().default(604_800_000),
    defaultConfidence: z.number().min(0).max(1).default(0.8),
    confidenceThreshold: z.number().min(0).max(1).default(0.5),
  }).default({}),
  quietHours: z.object({
    start: z.number().int().min(0).max(23).default(22),
    end: z.number().int().min(0).max(23).default(8),
  }).default({}),
});

export const irisConfigSchema = z.object({
  gateway: gatewaySchema.default({}),
  channels: z.record(z.string(), channelAccountSchema).default({}),
  security: securitySchema.default({}),
  opencode: openCodeSchema.default({}),
  cron: z.array(cronJobSchema).optional(),
  logging: loggingSchema.default({}),
  governance: governanceSchema.default({}),
  policy: policySchema,
  proactive: proactiveSchema.optional(),
  mcp: mcpSchema.default({}),
  plugins: z.array(z.string()).optional(),
  canvas: z.object({
    enabled: z.boolean().default(false),
    port: z.number().int().positive().default(19880),
    hostname: z.string().default("127.0.0.1"),
  }).optional(),
  autoReply: z.object({
    enabled: z.boolean().default(false),
    templates: z.array(z.object({
      id: z.string().min(1),
      trigger: z.object({
        type: z.enum(["exact", "regex", "keyword", "command", "schedule"]),
        pattern: z.string().optional(),
        words: z.array(z.string()).optional(),
        name: z.string().optional(),
        when: z.object({
          hours: z.tuple([z.number(), z.number()]).optional(),
          days: z.array(z.number()).optional(),
        }).optional(),
      }),
      response: z.string().min(1),
      priority: z.number().optional(),
      cooldown: z.number().positive().optional(),
      once: z.boolean().optional(),
      channels: z.array(z.string()).optional(),
      chatTypes: z.array(z.enum(["dm", "group"])).optional(),
      forwardToAi: z.boolean().optional(),
    })).default([]),
  }).optional(),
});

export function parseConfig(raw: unknown): IrisConfig {
  return irisConfigSchema.parse(raw) as IrisConfig;
}
