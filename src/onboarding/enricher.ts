import { detectAll } from "tinyld";
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

interface ScriptRange {
  readonly name: string;
  readonly ranges: readonly [number, number][];
}

const SCRIPT_RANGES: ScriptRange[] = [
  { name: "cyrillic", ranges: [[0x0400, 0x04ff], [0x0500, 0x052f]] },
  { name: "arabic", ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0xfb50, 0xfdff], [0xfe70, 0xfeff]] },
  { name: "devanagari", ranges: [[0x0900, 0x097f], [0xa8e0, 0xa8ff]] },
  { name: "thai", ranges: [[0x0e00, 0x0e7f]] },
  { name: "georgian", ranges: [[0x10a0, 0x10ff], [0x2d00, 0x2d2f]] },
  { name: "hangul", ranges: [[0xac00, 0xd7af], [0x1100, 0x11ff], [0x3130, 0x318f]] },
  { name: "cjk", ranges: [[0x4e00, 0x9fff], [0x3400, 0x4dbf], [0x3000, 0x303f], [0x3040, 0x309f], [0x30a0, 0x30ff]] },
  { name: "hebrew", ranges: [[0x0590, 0x05ff], [0xfb1d, 0xfb4f]] },
  { name: "greek", ranges: [[0x0370, 0x03ff], [0x1f00, 0x1fff]] },
  { name: "latin", ranges: [[0x0041, 0x024f], [0x1e00, 0x1eff]] },
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
    this.detectScript(senderId, channelId, text);
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
    if (text.length < 10) return;

    const results = detectAll(text);
    if (results.length === 0) return;

    const top = results[0];
    if (!top.lang) return;

    const confidence = Math.min(0.4 + text.length * 0.005, 0.75);

    this.signalStore.addSignal({
      senderId,
      channelId,
      signalType: "language",
      value: top.lang,
      confidence,
    });
    this.log.debug({ senderId, language: top.lang, confidence }, "detected language signal");
  }

  private detectScript(senderId: string, channelId: string, text: string): void {
    const counts = new Map<string, number>();
    let total = 0;

    for (const char of text) {
      const cp = char.codePointAt(0);
      if (cp === undefined) continue;
      if (cp <= 0x20 || (cp >= 0x2000 && cp <= 0x206f)) continue; // skip whitespace/punctuation

      for (const script of SCRIPT_RANGES) {
        for (const [lo, hi] of script.ranges) {
          if (cp >= lo && cp <= hi) {
            counts.set(script.name, (counts.get(script.name) ?? 0) + 1);
            total++;
            break;
          }
        }
      }
    }

    if (total === 0) return;

    let bestScript = "";
    let bestCount = 0;
    for (const [name, count] of counts) {
      if (count > bestCount) {
        bestScript = name;
        bestCount = count;
      }
    }

    if (bestScript) {
      this.signalStore.addSignal({
        senderId,
        channelId,
        signalType: "script",
        value: bestScript,
        confidence: 0.9,
      });
      this.log.debug({ senderId, script: bestScript }, "detected script signal");
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
