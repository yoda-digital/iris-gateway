export type DmPolicyMode = "open" | "pairing" | "allowlist" | "disabled";

export interface IrisConfig {
  readonly gateway: GatewayConfig;
  readonly channels: Record<string, ChannelAccountConfig>;
  readonly security: SecurityConfig;
  readonly opencode: OpenCodeConfig;
  readonly cron?: CronJobConfig[];
  readonly logging?: LoggingConfig;
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
