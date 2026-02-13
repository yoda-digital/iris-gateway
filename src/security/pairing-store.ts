import { readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { withFileLock } from "../utils/file-lock.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No 0O1I

export interface PairingRequest {
  readonly code: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export class PairingStore {
  private readonly filePath: string;
  private readonly ttlMs: number;
  private readonly codeLength: number;

  constructor(dataDir: string, ttlMs = 3_600_000, codeLength = 8) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, "pairing.json");
    this.ttlMs = ttlMs;
    this.codeLength = codeLength;
  }

  async issueCode(channelId: string, senderId: string): Promise<string> {
    return withFileLock(this.filePath, async () => {
      const requests = await this.readRequests();
      this.pruneExpired(requests);

      const existing = requests.find(
        (r) => r.channelId === channelId && r.senderId === senderId,
      );
      if (existing) return existing.code;

      const code = this.generateCode();
      const now = Date.now();
      requests.push({
        code,
        channelId,
        senderId,
        createdAt: now,
        expiresAt: now + this.ttlMs,
      });
      await this.writeRequests(requests);
      return code;
    });
  }

  async approveCode(
    code: string,
  ): Promise<{ channelId: string; senderId: string } | null> {
    return withFileLock(this.filePath, async () => {
      const requests = await this.readRequests();
      this.pruneExpired(requests);

      const idx = requests.findIndex(
        (r) => r.code === code.toUpperCase(),
      );
      if (idx === -1) return null;

      const request = requests[idx]!;
      const result = { channelId: request.channelId, senderId: request.senderId };
      requests.splice(idx, 1);
      await this.writeRequests(requests);
      return result;
    });
  }

  async listPending(): Promise<PairingRequest[]> {
    return withFileLock(this.filePath, async () => {
      const requests = await this.readRequests();
      const before = requests.length;
      this.pruneExpired(requests);
      if (requests.length !== before) {
        await this.writeRequests(requests);
      }
      return [...requests];
    });
  }

  async revokeCode(code: string): Promise<boolean> {
    return withFileLock(this.filePath, async () => {
      const requests = await this.readRequests();
      const idx = requests.findIndex((r) => r.code === code.toUpperCase());
      if (idx === -1) return false;

      requests.splice(idx, 1);
      await this.writeRequests(requests);
      return true;
    });
  }

  private generateCode(): string {
    const bytes = randomBytes(this.codeLength);
    let code = "";
    for (let i = 0; i < this.codeLength; i++) {
      code += ALPHABET[bytes[i]! % ALPHABET.length];
    }
    return code;
  }

  private pruneExpired(requests: PairingRequest[]): void {
    const now = Date.now();
    let i = requests.length;
    while (i--) {
      if (requests[i]!.expiresAt <= now) {
        requests.splice(i, 1);
      }
    }
  }

  private async readRequests(): Promise<PairingRequest[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as PairingRequest[];
    } catch {
      return [];
    }
  }

  private async writeRequests(requests: PairingRequest[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(requests, null, 2));
  }
}
