import { getSocket } from "./socket.js";
import { log } from "../util/log.js";

const MAX_LEN = 3500; // WhatsApp accepts ~4096 but we leave headroom.

export async function sendText(jid: string, text: string): Promise<void> {
  const sock = getSocket();
  const chunks = chunk(text, MAX_LEN);
  for (const c of chunks) {
    try {
      await sock.sendMessage(jid, { text: c });
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
    // Prefer breaking on a paragraph boundary, then newline, then space.
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
