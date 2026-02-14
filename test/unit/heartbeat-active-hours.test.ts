import { describe, it, expect, vi, afterEach } from "vitest";
import { isWithinActiveHours } from "../../src/heartbeat/active-hours.js";

describe("isWithinActiveHours", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("returns true when no config provided", () => {
    expect(isWithinActiveHours(undefined)).toBe(true);
  });

  it("returns true within active window", () => {
    // 2026-06-15 14:00 UTC = 17:00 Europe/Chisinau (UTC+3)
    vi.setSystemTime(new Date("2026-06-15T14:00:00Z"));
    expect(isWithinActiveHours({ start: "09:00", end: "22:00", timezone: "Europe/Chisinau" })).toBe(true);
  });

  it("returns false outside active window", () => {
    // 2026-06-15 04:00 UTC = 07:00 Europe/Chisinau (UTC+3)
    vi.setSystemTime(new Date("2026-06-15T04:00:00Z"));
    expect(isWithinActiveHours({ start: "09:00", end: "22:00", timezone: "Europe/Chisinau" })).toBe(false);
  });

  it("handles overnight window (start > end)", () => {
    // 2026-06-15 01:00 UTC = 04:00 Europe/Chisinau — inside 22:00-06:00
    vi.setSystemTime(new Date("2026-06-15T01:00:00Z"));
    expect(isWithinActiveHours({ start: "22:00", end: "06:00", timezone: "Europe/Chisinau" })).toBe(true);
  });

  it("falls back to UTC on invalid timezone", () => {
    vi.setSystemTime(new Date("2026-06-15T14:00:00Z"));
    expect(isWithinActiveHours({ start: "09:00", end: "22:00", timezone: "Invalid/Zone" })).toBe(true);
  });
});
