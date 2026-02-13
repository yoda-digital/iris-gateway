export type MemoryType = "fact" | "preference" | "event" | "insight";
export type MemorySource = "user_stated" | "extracted" | "system";

export interface Memory {
  readonly id: string;
  readonly sessionId: string;
  readonly channelId: string | null;
  readonly senderId: string | null;
  readonly type: MemoryType;
  readonly content: string;
  readonly source: MemorySource;
  readonly confidence: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number | null;
}

export interface UserProfile {
  readonly senderId: string;
  readonly channelId: string;
  readonly name: string | null;
  readonly timezone: string | null;
  readonly language: string | null;
  readonly preferences: Record<string, unknown>;
  readonly firstSeen: number;
  readonly lastSeen: number;
}

export interface AuditEntry {
  readonly id: number;
  readonly timestamp: number;
  readonly sessionId: string | null;
  readonly tool: string;
  readonly args: string | null;
  readonly result: string | null;
  readonly durationMs: number | null;
}

export interface GovernanceLogEntry {
  readonly id: number;
  readonly timestamp: number;
  readonly sessionId: string | null;
  readonly tool: string | null;
  readonly ruleId: string | null;
  readonly action: "allowed" | "blocked" | "modified";
  readonly reason: string | null;
}

export interface VaultContext {
  readonly profile: UserProfile | null;
  readonly memories: Memory[];
}
