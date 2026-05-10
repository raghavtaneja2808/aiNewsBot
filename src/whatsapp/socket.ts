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
import { isGroupAllowed } from "./allowlist.js";
import { appendMessages } from "../store/messages.js";
import type { MessageRecord } from "../store/types.js";

let sock: WASocket | null = null;
let onMessage: ((m: any) => void) | null = null;

function extractHistoryText(m: any): string {
  const msg = m?.message ?? {};
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    msg.ephemeralMessage?.message?.conversation ??
    msg.ephemeralMessage?.message?.extendedTextMessage?.text ??
    ""
  ).toString().trim();
}

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
    // History sync disabled — turning this on floods Baileys with decrypt
    // failures for messages from sibling devices with rotated keys, which
    // starves live message processing. Memory builds up from forward-only logging.
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

  // Backfill: WhatsApp streams chat history in chunks during the first few
  // minutes after a fresh link. We persist text messages from allowlisted groups.
  s.ev.on("messaging-history.set", async (ev) => {
    try {
      const recs: MessageRecord[] = [];
      for (const m of ev.messages ?? []) {
        const chatJid = m?.key?.remoteJid;
        if (!chatJid || !chatJid.endsWith("@g.us")) continue;
        if (!(await isGroupAllowed(chatJid))) continue;
        const text = extractHistoryText(m);
        if (!text) continue;
        const isFromMe = !!m?.key?.fromMe;
        const senderJid = (isFromMe ? (s.user as any)?.lid || s.user?.id : m?.key?.participant) ?? "";
        const tsRaw = m?.messageTimestamp;
        const ts = typeof tsRaw === "number" ? tsRaw * 1000 : Number(tsRaw ?? 0) * 1000 || Date.now();
        recs.push({
          source: "history",
          groupJid: chatJid,
          senderJid: String(senderJid).replace(/:\d+@/, "@"),
          senderName: typeof m?.pushName === "string" ? m.pushName : undefined,
          text,
          ts,
          id: m?.key?.id ?? undefined,
        });
      }
      if (recs.length) {
        const added = await appendMessages(recs);
        log.info({ chunk: ev.messages?.length ?? 0, persisted: added, isLatest: ev.isLatest }, "history.ingested");
      }
    } catch (err) {
      log.error({ err: String(err) }, "history.ingest_failed");
    }
  });

  s.ev.on("messages.upsert", (ev) => {
    if (!onMessage) return;
    // "notify" = real-time message from someone else.
    // "append" = a message from one of YOUR OWN linked devices (phone, web) —
    //   we want these so the operator can drive the bot from their own phone.
    // "prepend" = older history sync; ignore.
    if (ev.type !== "notify" && ev.type !== "append") return;
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
