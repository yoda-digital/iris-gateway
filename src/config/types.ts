import type { ProactiveConfig } from "../proactive/types.js";
import type { OnboardingConfig } from "../onboarding/types.js";
import type { HeartbeatConfig } from "../heartbeat/types.js";
export type DmPolicyMode = "open" | "pairing" | "allowlist" | "disabled";

export interface IrisConfig {
  readonly gateway: GatewayConfig;
  readonly channels: Record<string, ChannelAccountConfig>;
  readonly security: SecurityConfig;
  readonly opencode: OpenCodeConfig;
  readonly cron?: CronJobConfig[];
  readonly logging?: LoggingConfig;
  readonly governance?: GovernanceConfig;
  readonly policy?: PolicyConfig;
  readonly mcp?: McpConfig;
  readonly plugins?: string[];
  readonly autoReply?: AutoReplyConfig;
  readonly canvas?: CanvasConfig;
  readonly proactive?: ProactiveConfig;
  readonly onboarding?: OnboardingConfig;
  readonly heartbeat?: HeartbeatConfig;
  readonly cli?: import("../cli/types.js").CliConfig;
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

// ── Master Policy ──

export interface PolicyToolsConfig {
  /** Master allowlist — if non-empty, only these tools can be assigned/called. Empty = all allowed. */
  readonly allowed: string[];
  /** Explicit blocklist — always denied regardless of allowlist. */
  readonly denied: string[];
}

export interface PolicyPermissionsConfig {
  /** Master permission for bash — deny/allow. Default: deny. */
  readonly bash: "allow" | "deny";
  /** Master permission for file editing. Default: deny. */
  readonly edit: "allow" | "deny";
  /** Master permission for file reading. Default: deny. */
  readonly read: "allow" | "deny";
}

export interface PolicyAgentsConfig {
  /** Modes allowed for dynamically created agents. Default: [subagent]. */
  readonly allowedModes: string[];
  /** Max tool-call steps any dynamic agent can have. 0 = no limit. */
  readonly maxSteps: number;
  /** Require description field (OpenCode spec). Default: true. */
  readonly requireDescription: boolean;
  /** Tools every agent gets automatically. */
  readonly defaultTools: string[];
  /** Whether dynamic agents can be created as primary mode. Default: false. */
  readonly allowPrimaryCreation: boolean;
}

export interface PolicySkillsConfig {
  /** Skills that cannot be assigned to dynamic agents. */
  readonly restricted: string[];
  /** Warn (but don't block) if skill has no triggers. Default: false. */
  readonly requireTriggers: boolean;
}

export interface PolicyEnforcementConfig {
  /** Block tool calls not in master tools.allowed (if allowlist is non-empty). Default: true. */
  readonly blockUnknownTools: boolean;
  /** Log policy violations to audit trail. Default: true. */
  readonly auditPolicyViolations: boolean;
}

export interface PolicyConfig {
  readonly enabled: boolean;
  readonly tools: PolicyToolsConfig;
  readonly permissions: PolicyPermissionsConfig;
  readonly agents: PolicyAgentsConfig;
  readonly skills: PolicySkillsConfig;
  readonly enforcement: PolicyEnforcementConfig;
}
export type { ProactiveConfig } from "../proactive/types.js";
export type { OnboardingConfig } from "../onboarding/types.js";
export type { HeartbeatConfig } from "../heartbeat/types.js";
export type { CliConfig } from "../cli/types.js";
