import type { VaultDB } from "../vault/db.js";
import type { VaultStore } from "../vault/store.js";

const SEVEN_DAYS_MS = 7 * 86_400_000;
const DORMANCY_THRESHOLD_DAYS = 7;

export interface ActivityStats {
  readonly messageCount7d: number;
  readonly dormancyRisk: number;
  readonly lastMessageAt: number | null;
}

export class ActivityTracker {
  private readonly db;
  private readonly vaultStore: VaultStore;
  private readonly timestamps = new Map<string, number[]>();

  constructor(vaultDb: VaultDB, vaultStore: VaultStore) {
    this.db = vaultDb.raw();
    this.vaultStore = vaultStore;
  }

  recordMessage(senderId: string, channelId: string): void {
    const key = `${senderId}:${channelId}`;
    const now = Date.now();
    const ts = this.timestamps.get(key) ?? [];
    ts.push(now);
    // Keep only last 7 days
    const cutoff = now - SEVEN_DAYS_MS;
    const filtered = ts.filter((t) => t >= cutoff);
    this.timestamps.set(key, filtered);
  }

  getStats(senderId: string, channelId: string): ActivityStats {
    const key = `${senderId}:${channelId}`;
    const now = Date.now();
    const ts = this.timestamps.get(key) ?? [];
    const cutoff = now - SEVEN_DAYS_MS;
    const recent = ts.filter((t) => t >= cutoff);

    const profile = this.vaultStore.getProfile(senderId, channelId);
    const lastSeen = profile?.lastSeen ?? null;

    let dormancyRisk = 0;
    if (lastSeen) {
      const daysSince = (now - lastSeen) / 86_400_000;
      dormancyRisk = Math.min(daysSince / DORMANCY_THRESHOLD_DAYS, 1);
    }

    return {
      messageCount7d: recent.length,
      dormancyRisk,
      lastMessageAt: recent.length > 0 ? recent[recent.length - 1] : lastSeen,
    };
  }
}
