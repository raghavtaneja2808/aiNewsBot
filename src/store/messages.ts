import { db, persist } from "./db.js";
import type { Db, MessageRecord } from "./types.js";

const PER_GROUP_CAP = 2000;
const MAX_TEXT_LEN = 4000;

function clipText(s: string): string {
  return s.length > MAX_TEXT_LEN ? s.slice(0, MAX_TEXT_LEN) + "…" : s;
}

function pruneGroup(d: { data: Db }, jid: string): void {
  const inGroup = d.data.messages.filter((m) => m.groupJid === jid);
  if (inGroup.length <= PER_GROUP_CAP) return;
  const overflow = inGroup.length - PER_GROUP_CAP;
  const oldest = [...inGroup].sort((a, b) => a.ts - b.ts).slice(0, overflow);
  const dropSet = new Set(oldest);
  d.data.messages = d.data.messages.filter((m) => !dropSet.has(m));
}

/** Insert a single message; persist; return whether it was actually written. */
export async function appendMessage(rec: MessageRecord): Promise<boolean> {
  const text = rec.text?.trim() ?? "";
  if (!text) return false;

  const d = await db();
  if (rec.id) {
    for (let i = d.data.messages.length - 1; i >= 0; i--) {
      const m = d.data.messages[i];
      if (m.id === rec.id && m.groupJid === rec.groupJid) return false;
    }
  }

  d.data.messages.push({ ...rec, text: clipText(text) });
  pruneGroup(d, rec.groupJid);
  await persist();
  return true;
}

/** Bulk insert from history sync. One persist at the end. */
export async function appendMessages(recs: MessageRecord[]): Promise<number> {
  if (!recs.length) return 0;
  const d = await db();
  const seenIds = new Set(
    d.data.messages.filter((m) => m.id).map((m) => `${m.groupJid}|${m.id}`),
  );
  const touchedGroups = new Set<string>();
  let added = 0;
  for (const rec of recs) {
    const text = rec.text?.trim() ?? "";
    if (!text) continue;
    if (rec.id) {
      const k = `${rec.groupJid}|${rec.id}`;
      if (seenIds.has(k)) continue;
      seenIds.add(k);
    }
    d.data.messages.push({ ...rec, text: clipText(text) });
    touchedGroups.add(rec.groupJid);
    added++;
  }
  for (const g of touchedGroups) pruneGroup(d, g);
  d.data.messages.sort((a, b) => a.ts - b.ts);
  await persist();
  return added;
}

export async function getRecentMessages(groupJid: string, n: number): Promise<MessageRecord[]> {
  const d = await db();
  return d.data.messages
    .filter((m) => m.groupJid === groupJid)
    .sort((a, b) => a.ts - b.ts)
    .slice(-n);
}
