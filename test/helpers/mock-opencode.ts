import type {
  OpenCodeEvent,
  SessionInfo,
} from "../../src/bridge/opencode-client.js";

export class MockOpenCodeBridge {
  readonly sessions = new Map<string, SessionInfo>();
  private sessionCounter = 0;
  public responseText = "Hello from mock OpenCode!";

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

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
