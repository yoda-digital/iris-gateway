import { readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { OpenCodeBridge, SessionInfo } from "./opencode-client.js";

export interface SessionMapEntry {
  readonly openCodeSessionId: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly chatId: string;
  readonly chatType: "dm" | "group";
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export class SessionMap {
  private entries = new Map<string, SessionMapEntry>();
  private readonly filePath: string;
  private loaded = false;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, "sessions.json");
  }

  buildKey(
    channelId: string,
    chatId: string,
    chatType: "dm" | "group",
  ): string {
    return `${channelId}:${chatType}:${chatId}`;
  }

  async resolve(
    channelId: string,
    senderId: string,
    chatId: string,
    chatType: "dm" | "group",
    bridge: OpenCodeBridge,
  ): Promise<SessionMapEntry> {
    await this.ensureLoaded();
    const key = this.buildKey(channelId, chatId, chatType);
    const existing = this.entries.get(key);

    if (existing) {
      const updated: SessionMapEntry = {
        ...existing,
        lastActiveAt: Date.now(),
      };
      this.entries.set(key, updated);
      await this.save();
      return updated;
    }

    const title = `${channelId}:${chatType === "dm" ? senderId : chatId}`;
    const session: SessionInfo = await bridge.createSession(title);

    const entry: SessionMapEntry = {
      openCodeSessionId: session.id,
      channelId,
      senderId,
      chatId,
      chatType,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.entries.set(key, entry);
    await this.save();
    return entry;
  }

  async reset(key: string): Promise<void> {
    await this.ensureLoaded();
    this.entries.delete(key);
    await this.save();
  }

  async findBySessionId(openCodeSessionId: string): Promise<SessionMapEntry | null> {
    await this.ensureLoaded();
    for (const entry of this.entries.values()) {
      if (entry.openCodeSessionId === openCodeSessionId) return entry;
    }
    return null;
  }

  async list(): Promise<SessionMapEntry[]> {
    await this.ensureLoaded();
    return [...this.entries.values()];
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, SessionMapEntry>;
      this.entries = new Map(Object.entries(data));
    } catch {
      this.entries = new Map();
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const data = Object.fromEntries(this.entries);
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}
