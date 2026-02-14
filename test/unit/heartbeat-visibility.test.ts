import { describe, it, expect } from "vitest";
import { resolveVisibility, type VisibilityConfig, type ChannelVisibilityOverrides } from "../../src/heartbeat/visibility.js";

describe("resolveVisibility", () => {
  const defaults: VisibilityConfig = { showOk: false, showAlerts: true, useIndicator: true };

  it("returns global defaults when no channel override", () => {
    const result = resolveVisibility(defaults, undefined, "telegram");
    expect(result).toEqual({ showOk: false, showAlerts: true, useIndicator: true });
  });

  it("applies channel override for showAlerts", () => {
    const overrides: ChannelVisibilityOverrides = { telegram: { showAlerts: false } };
    const result = resolveVisibility(defaults, overrides, "telegram");
    expect(result.showAlerts).toBe(false);
    expect(result.showOk).toBe(false);
    expect(result.useIndicator).toBe(true);
  });

  it("returns defaults for channels without override", () => {
    const overrides: ChannelVisibilityOverrides = { telegram: { showAlerts: false } };
    const result = resolveVisibility(defaults, overrides, "discord");
    expect(result.showAlerts).toBe(true);
  });

  it("handles undefined global config with safe defaults", () => {
    const result = resolveVisibility(undefined, undefined, "telegram");
    expect(result).toEqual({ showOk: false, showAlerts: true, useIndicator: true });
  });
});
