export interface VisibilityConfig {
  readonly showOk: boolean;
  readonly showAlerts: boolean;
  readonly useIndicator: boolean;
}

export type ChannelVisibilityOverrides = Record<string, Partial<VisibilityConfig>>;

const DEFAULTS: VisibilityConfig = { showOk: false, showAlerts: true, useIndicator: true };

export function resolveVisibility(
  global: VisibilityConfig | undefined,
  channelOverrides: ChannelVisibilityOverrides | undefined,
  channelId: string,
): VisibilityConfig {
  const base = global ?? DEFAULTS;
  const override = channelOverrides?.[channelId];
  if (!override) return { ...base };

  return {
    showOk: override.showOk ?? base.showOk,
    showAlerts: override.showAlerts ?? base.showAlerts,
    useIndicator: override.useIndicator ?? base.useIndicator,
  };
}
