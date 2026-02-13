import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import { join } from "node:path";
import { getStateDir } from "../../config/paths.js";

export async function createWhatsAppSocket(
  signal: AbortSignal,
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

  const onConnectionUpdate = (
    cb: (update: Partial<ConnectionState>) => void,
  ): void => {
    socket.ev.on("connection.update", (update) => {
      cb(update);
      if (update.connection === "close" && !signal.aborted) {
        const boom = update.lastDisconnect?.error as
          | { output?: { statusCode?: number } }
          | undefined;
        const statusCode = boom?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          // Session invalidated — don't reconnect
          return;
        }
        // For other disconnect reasons, Baileys auto-reconnects internally
      }
    });
  };

  return { socket, onConnectionUpdate };
}
