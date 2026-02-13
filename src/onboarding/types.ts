export interface ProfileSignal {
  readonly id: number;
  readonly senderId: string;
  readonly channelId: string;
  readonly signalType: string;
  readonly value: string;
  readonly confidence: number;
  readonly observedAt: number;
}

export interface AddSignalParams {
  readonly senderId: string;
  readonly channelId: string;
  readonly signalType: string;
  readonly value: string;
  readonly confidence?: number;
}

export interface OnboardingConfig {
  readonly enabled: boolean;
  readonly enricher: {
    readonly enabled: boolean;
    readonly signalRetentionDays: number;
    readonly consolidateIntervalMs: number;
  };
  readonly firstContact: {
    readonly enabled: boolean;
  };
}
