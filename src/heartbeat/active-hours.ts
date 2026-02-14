export interface ActiveHoursConfig {
  readonly start: string;  // "HH:MM"
  readonly end: string;    // "HH:MM"
  readonly timezone: string; // IANA timezone
}

function getCurrentHourMin(timezone: string): { hour: number; minute: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const hour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
    return { hour, minute };
  } catch {
    // Invalid timezone — fall back to UTC
    const now = new Date();
    return { hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
}

function parseTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function isWithinActiveHours(config: ActiveHoursConfig | undefined): boolean {
  if (!config) return true;

  const { hour, minute } = getCurrentHourMin(config.timezone);
  const now = hour * 60 + minute;
  const start = parseTime(config.start);
  const end = parseTime(config.end);

  if (start <= end) {
    // Normal window: 09:00 - 22:00
    return now >= start && now < end;
  }
  // Overnight window: 22:00 - 06:00
  return now >= start || now < end;
}
