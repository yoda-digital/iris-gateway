import type {
  OpenCodeEvent,
  PromptOptions,
  SessionInfo,
} from "../../src/bridge/opencode-client.js";
import type { SessionDiff } from "../../src/bridge/diff-summary.js";

export class MockOpenCodeBridge {
  readonly sessions = new Map<string, SessionInfo>();
  private sessionCounter = 0;
  public responseText = "Hello from mock OpenCode!";
  public mockDiff: SessionDiff | null = null;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async createSession(title?: string): Promise<SessionInfo> {
    const id = `mock-session-${++this.sessionCounter}`;
    const session: SessionInfo = {
      id,
      title: title ?? "Mock Session",
      createdAt: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  async sendMessage(_sessionId: string, _text: string): Promise<string> {
    return this.responseText;
  }

  async sendAndWait(_sessionId: string, _text: string, _timeoutMs?: number, _pollMs?: number, _options?: PromptOptions): Promise<string> {
    return this.responseText;
  }

  async getSessionDiff(_sessionId: string): Promise<SessionDiff | null> {
    return this.mockDiff;
  }

  async sendMessageAsync(_sessionId: string, _text: string): Promise<void> {}

  async subscribeEvents(
    _onEvent: (event: OpenCodeEvent) => void,
  ): Promise<void> {
    // No-op for mock — events are simulated by tests directly
  }

  async abortSession(_sessionId: string): Promise<void> {}

  async checkHealth(): Promise<boolean> {
    return true;
  }

  async listSessions(): Promise<SessionInfo[]> {
    return [...this.sessions.values()];
  }

  getCircuitBreaker() { return { allowRequest: () => true, onSuccess: () => {}, onFailure: () => {}, getState: () => 'CLOSED' as const, unavailableMessage: 'temporarily unavailable', reset: () => {} }; }

  isAvailable(): boolean {
    return true;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  readonly permissionDecisions: Array<{ sessionId: string; permissionId: string; response: string }> = [];

  async approvePermission(sessionId: string, permissionId: string, response: "once" | "always" | "reject"): Promise<void> {
    this.permissionDecisions.push({ sessionId, permissionId, response });
  }
}
