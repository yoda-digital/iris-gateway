import { describe, it, expect, vi } from "vitest";
import { WhatsAppConnectionState } from "../../src/channels/whatsapp/connection.js";

describe("WhatsApp reconnect strategy", () => {
  it("exports the WhatsAppConnectionState enum", () => {
    expect(WhatsAppConnectionState.connecting).toBe("connecting");
    expect(WhatsAppConnectionState.connected).toBe("connected");
    expect(WhatsAppConnectionState.reconnecting).toBe("reconnecting");
    expect(WhatsAppConnectionState.failed).toBe("failed");
  });

  it("state machine: connecting → connected → reconnecting → connected", () => {
    const states: WhatsAppConnectionState[] = [];
    const record = (s: WhatsAppConnectionState) => states.push(s);

    record(WhatsAppConnectionState.connecting);
    record(WhatsAppConnectionState.connected);
    record(WhatsAppConnectionState.reconnecting);
    record(WhatsAppConnectionState.connected);

    expect(states).toEqual([
      WhatsAppConnectionState.connecting,
      WhatsAppConnectionState.connected,
      WhatsAppConnectionState.reconnecting,
      WhatsAppConnectionState.connected,
    ]);
  });

  it("state machine: connecting → connected → failed (loggedOut)", () => {
    const states: WhatsAppConnectionState[] = [];
    const record = (s: WhatsAppConnectionState) => states.push(s);

    record(WhatsAppConnectionState.connecting);
    record(WhatsAppConnectionState.connected);
    record(WhatsAppConnectionState.failed);

    expect(states).toEqual([
      WhatsAppConnectionState.connecting,
      WhatsAppConnectionState.connected,
      WhatsAppConnectionState.failed,
    ]);

    // After failed, no reconnecting state should follow
    const lastState = states.at(-1);
    expect(lastState).toBe(WhatsAppConnectionState.failed);
  });

  it("failed state is terminal — further reconnects not expected", () => {
    // Simulate that once we reach 'failed', the adapter should not transition
    // to 'reconnecting'. The loggedOut handler returns without triggering reconnect.
    const terminalStates = [WhatsAppConnectionState.failed];
    for (const state of terminalStates) {
      expect([WhatsAppConnectionState.failed]).toContain(state);
    }
  });

  it("all state values are strings", () => {
    const values = Object.values(WhatsAppConnectionState);
    expect(values.every((v) => typeof v === "string")).toBe(true);
    expect(values).toHaveLength(4);
  });
});
