import { getSocket } from "./socket.js";
import { log } from "../util/log.js";
import { appendMessage } from "../store/messages.js";

/** Show "typing…" in the chat. Best-effort: we silently ignore failures so a
 *  Baileys hiccup never breaks the actual command flow. */
export async function setTyping(jid: string, on: boolean): Promise<void> {
  try {
    const sock = getSocket();
    await sock.sendPresenceUpdate(on ? "composing" : "paused", jid);
    log.info({ jid, state: on ? "composing" : "paused" }, "presence");
  } catch (err) {
    log.warn({ err: String(err), jid }, "presence.failed");
  }
}

const MAX_LEN = 3500; // WhatsApp accepts ~4096 but we leave headroom.

/**
 * Message IDs the bot sent itself. The router consults this to distinguish
 * "the bot's own outbound reply echoed back as fromMe=true" (skip) from
 * "the operator typed something on the linked phone" (process normally).
 *
 * Bounded: only the most recent IDs are kept, since old echoes can't reasonably
 * arrive minutes later.
 */
const SENT_IDS_MAX = 500;
const sentIds: string[] = [];
const sentIdSet = new Set<string>();

export function rememberSentId(id: string | null | undefined): void {
  if (!id) return;
  if (sentIdSet.has(id)) return;
  sentIds.push(id);
  sentIdSet.add(id);
  while (sentIds.length > SENT_IDS_MAX) {
    const old = sentIds.shift()!;
    sentIdSet.delete(old);
  }
}

export function isSelfSentId(id: string | null | undefined): boolean {
  if (!id) return false;
  return sentIdSet.has(id);
}

export async function sendText(jid: string, text: string): Promise<void> {
  const sock = getSocket();
  const ownJid = (sock.user as any)?.lid || sock.user?.id || "bot";
  const chunks = chunk(text, MAX_LEN);
  for (const c of chunks) {
    try {
      const sent = await sock.sendMessage(jid, { text: c });
      rememberSentId(sent?.key?.id);
      // Only log to message store for groups (everything else the router would
      // never persist anyway since DMs/non-allowlisted groups are dropped).
      if (jid.endsWith("@g.us")) {
        await appendMessage({
          source: "out",
          groupJid: jid,
          senderJid: ownJid,
          senderName: "Bot",
          text: c,
          ts: Date.now(),
          id: sent?.key?.id ?? undefined,
        }).catch((err) => log.warn({ err: String(err) }, "outbound appendMessage failed"));
      }
    } catch (err) {
      log.error({ err: String(err), jid }, "sendMessage failed");
      throw err;
    }
  }
}

function chunk(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
