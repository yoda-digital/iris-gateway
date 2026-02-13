import type { SignalStore } from "./signals.js";
import type { VaultStore } from "../vault/store.js";
import type { UserProfile } from "../vault/types.js";
import type { Logger } from "../logging/logger.js";

export interface EnrichParams {
  readonly senderId: string;
  readonly channelId: string;
  readonly text: string;
  readonly timestamp: number;
}

interface LanguagePattern {
  readonly code: string;
  readonly patterns: RegExp[];
}

const LANGUAGE_PATTERNS: LanguagePattern[] = [
  {
    code: "ro",
    patterns: [/\bsalut\b/i, /\bbun[ăa]\b/i, /\bmul[țt]umesc\b/i, /\bcum\s+e[sș]ti\b/i],
  },
  {
    code: "ru",
    patterns: [/\bпривет\b/i, /\bздравствуй\b/i, /\bспасибо\b/i, /\bкак\s+дела\b/i],
  },
  {
    code: "es",
    patterns: [/\bhola\b/i, /\bgracias\b/i, /\bbuenos\b/i, /\bc[oó]mo\b/i],
  },
  {
    code: "fr",
    patterns: [/\bbonjour\b/i, /\bmerci\b/i, /\bcomment\b/i],
  },
  {
    code: "de",
    patterns: [/\bhallo\b/i, /\bdanke\b/i, /\bwie\s+geht\b/i],
  },
];

const NAME_PATTERNS: RegExp[] = [
  /\bI'?m\s+([A-Z][a-z]{1,20})\b/,
  /\bmy\s+name\s+is\s+([A-Z][a-z]{1,20})\b/i,
  /\bcall\s+me\s+([A-Z][a-z]{1,20})\b/i,
];

export class ProfileEnricher {
  private readonly signalStore: SignalStore;
  private readonly vaultStore: VaultStore;
  private readonly log: Logger;
  private readonly messageLengths = new Map<string, number[]>();

  constructor(signalStore: SignalStore, vaultStore: VaultStore, log: Logger) {
    this.signalStore = signalStore;
    this.vaultStore = vaultStore;
    this.log = log;
  }

  enrich(params: EnrichParams): void {
    const { senderId, channelId, text, timestamp } = params;
    if (!text.trim()) return;

    this.detectLanguage(senderId, channelId, text);
    this.extractActiveHours(senderId, channelId, timestamp);
    this.detectName(senderId, channelId, text);
    this.trackResponseStyle(senderId, channelId, text);
  }

  consolidateProfile(senderId: string, channelId: string): void {
    const signals = this.signalStore.consolidate(senderId, channelId);

    this.vaultStore.upsertProfile({
      senderId,
      channelId,
      timezone: signals.get("timezone") ?? null,
      language: signals.get("language") ?? null,
      name: signals.get("name") ?? null,
    });

    this.log.debug({ senderId, channelId }, "consolidated profile signals");
  }

  isFirstContact(profile: UserProfile): boolean {
    return (
      Date.now() - profile.firstSeen < 30_000 &&
      profile.firstSeen === profile.lastSeen
    );
  }

  private detectLanguage(senderId: string, channelId: string, text: string): void {
    for (const lang of LANGUAGE_PATTERNS) {
      for (const pattern of lang.patterns) {
        if (pattern.test(text)) {
          this.signalStore.addSignal({
            senderId,
            channelId,
            signalType: "language",
            value: lang.code,
            confidence: 0.6,
          });
          this.log.debug({ senderId, language: lang.code }, "detected language signal");
          return;
        }
      }
    }
  }

  private extractActiveHours(senderId: string, channelId: string, timestamp: number): void {
    const hour = new Date(timestamp).getUTCHours();
    this.signalStore.addSignal({
      senderId,
      channelId,
      signalType: "active_hour",
      value: String(hour),
      confidence: 0.5,
    });
  }

  private detectName(senderId: string, channelId: string, text: string): void {
    for (const pattern of NAME_PATTERNS) {
      const match = pattern.exec(text);
      if (match?.[1]) {
        this.signalStore.addSignal({
          senderId,
          channelId,
          signalType: "name",
          value: match[1],
          confidence: 0.8,
        });
        this.log.debug({ senderId, name: match[1] }, "detected name signal");
        return;
      }
    }
  }

  private trackResponseStyle(senderId: string, channelId: string, text: string): void {
    const key = `${senderId}:${channelId}`;
    let lengths = this.messageLengths.get(key);
    if (!lengths) {
      lengths = [];
      this.messageLengths.set(key, lengths);
    }

    lengths.push(text.length);
    if (lengths.length > 20) {
      lengths.splice(0, lengths.length - 20);
    }

    if (lengths.length >= 5) {
      const avg = lengths.reduce((sum, l) => sum + l, 0) / lengths.length;
      let style: string;
      if (avg < 30) {
        style = "concise";
      } else if (avg < 150) {
        style = "moderate";
      } else {
        style = "verbose";
      }

      const confidence = Math.min(0.5 + lengths.length * 0.02, 0.9);

      this.signalStore.addSignal({
        senderId,
        channelId,
        signalType: "response_style",
        value: style,
        confidence,
      });
    }
  }
}
