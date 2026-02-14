export interface CliActionDef {
  readonly subcommand: string[];
  readonly positional?: string[];
  readonly flags?: string[];
}

export interface CliToolDef {
  readonly binary: string;
  readonly description: string;
  readonly actions: Record<string, CliActionDef>;
}

export interface CliSandboxConfig {
  readonly allowedBinaries: string[];
}

export interface CliConfig {
  readonly enabled: boolean;
  readonly timeout: number;
  readonly sandbox: CliSandboxConfig;
  readonly tools: Record<string, CliToolDef>;
}

export interface CliExecResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly exitCode: number;
}

export interface CliToolManifest {
  [toolName: string]: {
    description: string;
    actions: Record<string, {
      positional?: string[];
      flags?: string[];
    }>;
  };
}
