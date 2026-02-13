import { z } from "zod";
import type { IrisConfig } from "./types.js";

const dmPolicySchema = z.enum(["open", "pairing", "allowlist", "disabled"]);

const groupPolicySchema = z.object({
  enabled: z.boolean().default(false),
  requireMention: z.boolean().default(true),
  allowedCommands: z.array(z.string()).optional(),
});

const channelAccountSchema = z.object({
  type: z.enum(["telegram", "whatsapp", "discord", "slack"]),
  enabled: z.boolean().default(false),
  token: z.string().optional(),
  appToken: z.string().optional(),
  botToken: z.string().optional(),
  dmPolicy: dmPolicySchema.optional(),
  groupPolicy: groupPolicySchema.optional(),
  mentionPattern: z.string().optional(),
  maxTextLength: z.number().positive().optional(),
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

export const irisConfigSchema = z.object({
  gateway: gatewaySchema.default({}),
  channels: z.record(z.string(), channelAccountSchema).default({}),
  security: securitySchema.default({}),
  opencode: openCodeSchema.default({}),
  cron: z.array(cronJobSchema).optional(),
  logging: loggingSchema.default({}),
});

export function parseConfig(raw: unknown): IrisConfig {
  return irisConfigSchema.parse(raw) as IrisConfig;
}
