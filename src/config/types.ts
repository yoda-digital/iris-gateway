export type DmPolicyMode = "open" | "pairing" | "allowlist" | "disabled";

export interface IrisConfig {
  readonly gateway: GatewayConfig;
  readonly channels: Record<string, ChannelAccountConfig>;
  readonly security: SecurityConfig;
  readonly opencode: OpenCodeConfig;
  readonly cron?: CronJobConfig[];
  readonly logging?: LoggingConfig;
  readonly governance?: GovernanceConfig;
  readonly mcp?: McpConfig;
}

export interface GatewayConfig {
  readonly port: number;
  readonly hostname: string;
}

export interface ChannelAccountConfig {
  readonly type: "telegram" | "whatsapp" | "discord" | "slack";
  readonly enabled: boolean;
  readonly token?: string;
  readonly appToken?: string;
  readonly botToken?: string;
  readonly dmPolicy?: DmPolicyMode;
  readonly groupPolicy?: GroupPolicyConfig;
  readonly mentionPattern?: string;
  readonly maxTextLength?: number;
}

export interface SecurityConfig {
  readonly defaultDmPolicy: DmPolicyMode;
  readonly pairingCodeTtlMs: number;
  readonly pairingCodeLength: number;
  readonly rateLimitPerMinute: number;
  readonly rateLimitPerHour: number;
}

export interface OpenCodeConfig {
  readonly port: number;
  readonly hostname: string;
  readonly autoSpawn: boolean;
  readonly projectDir?: string;
}

export interface GroupPolicyConfig {
  readonly enabled: boolean;
  readonly requireMention: boolean;
  readonly allowedCommands?: string[];
}

export interface CronJobConfig {
  readonly name: string;
  readonly schedule: string;
  readonly prompt: string;
  readonly channel: string;
  readonly chatId: string;
}

export interface LoggingConfig {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly file?: string;
  readonly json?: boolean;
}

export interface GovernanceRuleConfig {
  readonly id: string;
  readonly description: string;
  readonly tool: string;
  readonly type: "rate_limit" | "constraint" | "custom" | "audit";
  readonly params: Record<string, unknown>;
}

export interface GovernanceConfig {
  readonly enabled: boolean;
  readonly rules: GovernanceRuleConfig[];
  readonly directives: string[];
}

export interface McpServerConfig {
  readonly enabled: boolean;
}

export interface McpConfig {
  readonly enabled: boolean;
  readonly servers: Record<string, McpServerConfig>;
}
