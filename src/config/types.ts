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
  readonly plugins?: string[];
  readonly autoReply?: AutoReplyConfig;
  readonly canvas?: CanvasConfig;
}

export interface CanvasConfig {
  readonly enabled: boolean;
  readonly port: number;
  readonly hostname: string;
}

export interface AutoReplyConfig {
  readonly enabled: boolean;
  readonly templates: AutoReplyTemplateConfig[];
}

export interface AutoReplyTemplateConfig {
  readonly id: string;
  readonly trigger: {
    readonly type: "exact" | "regex" | "keyword" | "command" | "schedule";
    readonly pattern?: string;
    readonly words?: string[];
    readonly name?: string;
    readonly when?: { hours?: [number, number]; days?: number[] };
  };
  readonly response: string;
  readonly priority?: number;
  readonly cooldown?: number;
  readonly once?: boolean;
  readonly channels?: string[];
  readonly chatTypes?: ("dm" | "group")[];
  readonly forwardToAi?: boolean;
}

export interface GatewayConfig {
  readonly port: number;
  readonly hostname: string;
}

export interface ChannelAccountConfig {
  readonly type: "telegram" | "whatsapp" | "discord" | "slack" | "webchat";
  readonly enabled: boolean;
  readonly token?: string;
  readonly appToken?: string;
  readonly botToken?: string;
  readonly dmPolicy?: DmPolicyMode;
  readonly groupPolicy?: GroupPolicyConfig;
  readonly mentionPattern?: string;
  readonly maxTextLength?: number;
  readonly streaming?: StreamingConfig;
}

export interface StreamingConfig {
  readonly enabled: boolean;
  readonly minChars?: number;
  readonly maxChars?: number;
  readonly idleMs?: number;
  readonly breakOn?: "paragraph" | "sentence" | "word";
  readonly editInPlace?: boolean;
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
