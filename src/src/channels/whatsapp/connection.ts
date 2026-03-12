/**
 * WhatsApp Connection Module — using Baileys library
 *
 * ## Reconnect Strategy
 *
 * Baileys handles reconnection internally for most disconnect reasons.
 * The strategy implemented here:
 *
 * 1. **loggedOut** (statusCode 401): The session was explicitly invalidated (phone
 *    unlinked, session revoked). We DO NOT reconnect — the auth state is invalid
 *    and reconnecting would fail. The adapter emits "disconnected" and stops.
 *
 * 2. **connectionClosed / connectionLost / timedOut** (other codes): Baileys
 *    automatically recreates the socket and reconnects. No manual intervention
 *    needed. The adapter emits "disconnected" transiently and "connected" when
 *    the socket reopens.
 *
 * 3. **AbortSignal**: If the gateway is shutting down (signal.aborted), we
 *    suppress reconnect handling and let the connection close cleanly.
 *
 * ## Connection States
 *
 * States flow through the exported `WhatsAppConnectionState` enum:
 * - connecting → connected → reconnecting → connected (on drop)
 *                          → failed (on loggedOut)
 */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import { join } from "node:path";
import { getStateDir } from "../../config/paths.js";

/** Explicit connection state for observability. */
export enum WhatsAppConnectionState {
  /** Initial socket creation in progress. */
  connecting = "connecting",
  /** Socket open and receiving messages. */
  connected = "connected",
  /** Connection dropped; Baileys is attempting to reconnect. */
  reconnecting = "reconnecting",
  /** Session invalidated (loggedOut). Manual re-auth required. */
  failed = "failed",
}

export async function createWhatsAppSocket(
  signal: AbortSignal,
  onStateChange?: (state: WhatsAppConnectionState) => void,
): Promise<{
  socket: WASocket;
  onConnectionUpdate: (
    cb: (update: Partial<ConnectionState>) => void,
  ) => void;
}> {
  const authDir = join(getStateDir(), "whatsapp-auth");
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  socket.ev.on("creds.update", saveCreds);

  onStateChange?.(WhatsAppConnectionState.connecting);

  const onConnectionUpdate = (
    cb: (update: Partial<ConnectionState>) => void,
  ): void => {
    socket.ev.on("connection.update", (update) => {
      cb(update);

      if (update.connection === "open") {
        onStateChange?.(WhatsAppConnectionState.connected);
        return;
      }

      if (update.connection === "close" && !signal.aborted) {
        const boom = update.lastDisconnect?.error as
          | { output?: { statusCode?: number } }
          | undefined;
        const statusCode = boom?.output?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          // Session invalidated — do not reconnect, auth state is invalid.
          // User must re-link their WhatsApp account.
          onStateChange?.(WhatsAppConnectionState.failed);
          return;
        }

        // For all other disconnect reasons (connection dropped, timed out,
        // server-side close), Baileys automatically recreates the socket
        // and reconnects. We just track the transitional state.
        onStateChange?.(WhatsAppConnectionState.reconnecting);
      }
    });
  };

  return { socket, onConnectionUpdate };
}
