import type { InboundMessage } from "../channels/adapter.js";
import type { AutoReplyTemplate, TemplateMatch } from "./types.js";

export class TemplateEngine {
  private readonly templates: AutoReplyTemplate[];
  private readonly cooldowns = new Map<string, number>();
  private readonly onceFired = new Set<string>();

  constructor(templates: AutoReplyTemplate[]) {
    this.templates = [...templates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  match(msg: InboundMessage): TemplateMatch | null {
    const text = msg.text ?? "";
    for (const tpl of this.templates) {
      if (tpl.channels && !tpl.channels.includes(msg.channelId)) continue;
      if (tpl.chatTypes && !tpl.chatTypes.includes(msg.chatType)) continue;

      const coolKey = `${tpl.id}:${msg.senderId}`;
      if (tpl.cooldown) {
        const last = this.cooldowns.get(coolKey);
        if (last && Date.now() - last < tpl.cooldown * 1000) continue;
      }
      if (tpl.once && this.onceFired.has(coolKey)) continue;

      if (!this.triggerMatches(tpl.trigger, text)) continue;

      // Match found
      if (tpl.cooldown) this.cooldowns.set(coolKey, Date.now());
      if (tpl.once) this.onceFired.add(coolKey);

      return { template: tpl, response: this.render(tpl.response, msg) };
    }
    return null;
  }

  private triggerMatches(trigger: AutoReplyTemplate["trigger"], text: string): boolean {
    switch (trigger.type) {
      case "exact":
        return text.toLowerCase().trim() === trigger.pattern.toLowerCase().trim();
      case "regex":
        return new RegExp(trigger.pattern, "i").test(text);
      case "keyword":
        return trigger.words.some((w) => text.toLowerCase().includes(w.toLowerCase()));
      case "command":
        return text.trim().toLowerCase().startsWith(`/${trigger.name.toLowerCase()}`);
      case "schedule":
        return this.scheduleActive(trigger.when);
    }
  }

  private scheduleActive(when: { hours?: [number, number]; days?: number[]; timezone?: string }): boolean {
    const now = new Date();
    let hour: number;
    let day: number;

    if (when.timezone) {
      try {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: when.timezone,
          hour: "numeric",
          weekday: "short",
          hour12: false,
        });
        const parts = fmt.formatToParts(now);
        const hourPart = parts.find((p) => p.type === "hour");
        const weekdayPart = parts.find((p) => p.type === "weekday");
        hour = hourPart ? parseInt(hourPart.value, 10) : now.getHours();
        const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        day = weekdayPart ? weekdays.indexOf(weekdayPart.value) : now.getDay();
        if (day === -1) day = now.getDay();
      } catch {
        // Invalid timezone — fall back to local time
        hour = now.getHours();
        day = now.getDay();
      }
    } else {
      hour = now.getHours();
      day = now.getDay();
    }

    if (when.hours) {
      if (hour < when.hours[0] || hour >= when.hours[1]) return false;
    }
    if (when.days) {
      if (!when.days.includes(day)) return false;
    }
    return true;
  }

  private render(template: string, msg: InboundMessage): string {
    return template
      .replace(/\{sender\.name\}/g, msg.senderName ?? "there")
      .replace(/\{sender\.id\}/g, msg.senderId)
      .replace(/\{channel\}/g, msg.channelId)
      .replace(/\{time\}/g, new Date().toLocaleTimeString())
      .replace(/\{date\}/g, new Date().toLocaleDateString());
  }
}
