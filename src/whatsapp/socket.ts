import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { mkdir } from "node:fs/promises";
import { config } from "../config.js";
import { log } from "../util/log.js";

let sock: WASocket | null = null;
let onMessage: ((m: any) => void) | null = null;

export function setMessageHandler(handler: (m: any) => void): void {
  onMessage = handler;
}

export function getSocket(): WASocket {
  if (!sock) throw new Error("WhatsApp socket not initialized yet.");
  return sock;
}

async function start(): Promise<WASocket> {
  await mkdir(config.authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  log.info({ version, isLatest }, "baileys.version");

  const s = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: log.child({ mod: "baileys" }) as any,
    browser: ["AINewsBot", "Chrome", "1.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  s.ev.on("creds.update", saveCreds);

  s.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      log.info("Scan this QR with WhatsApp → Linked devices:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      log.info("WhatsApp connection: open");
    }

    if (connection === "close") {
      const status = (lastDisconnect?.error as any)?.output?.statusCode as number | undefined;
      const shouldReconnect = status !== DisconnectReason.loggedOut;
      log.warn({ status, shouldReconnect }, "WhatsApp connection: close");
      if (shouldReconnect) {
        // Reconnect after a short backoff. Auth state is persisted, so no new QR.
        setTimeout(() => {
          start().catch((err) => log.error({ err: String(err) }, "reconnect failed"));
        }, 2_000);
      } else {
        log.error("Logged out by WhatsApp — delete data/auth and rescan to recover.");
      }
    }
  });

  s.ev.on("messages.upsert", (ev) => {
    if (!onMessage) return;
    if (ev.type !== "notify") return;
    for (const m of ev.messages) {
      try {
        onMessage(m);
      } catch (err) {
        log.error({ err: String(err) }, "message handler threw");
      }
    }
  });

  sock = s;
  return s;
}

export async function startSocket(): Promise<WASocket> {
  return start();
}
