import { db, persist } from "../../store/db.js";
import type { DigestEntry } from "../../store/types.js";
import { formatInTz } from "../../util/time.js";
import { getOrCreateGroup } from "./settings.js";

const MAX_PER_GROUP = 20;

export async function recordDigest(entry: DigestEntry): Promise<void> {
  const d = await db();
  d.data.digests.push(entry);
  // Prune to most recent N per group.
  const grouped = new Map<string, DigestEntry[]>();
  for (const e of d.data.digests) {
    const arr = grouped.get(e.groupJid) ?? [];
    arr.push(e);
    grouped.set(e.groupJid, arr);
  }
  const kept: DigestEntry[] = [];
  for (const arr of grouped.values()) {
    arr.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    kept.push(...arr.slice(0, MAX_PER_GROUP));
  }
  d.data.digests = kept;
  await persist();
}

export async function lastDigests(groupJid: string, n = 5): Promise<DigestEntry[]> {
  const d = await db();
  return d.data.digests
    .filter((e) => e.groupJid === groupJid)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .slice(0, n);
}

export async function formatHistory(groupJid: string, n = 5): Promise<string> {
  const entries = await lastDigests(groupJid, n);
  if (!entries.length) return "No digests have been sent in this group yet.";
  const g = await getOrCreateGroup(groupJid);
  const blocks = entries.map((e) => {
    const when = formatInTz(e.sentAt, g.timezone) + " " + g.timezone;
    const links = e.stories.map((s, i) => `  ${i + 1}. ${s.title}\n     ${s.url}`).join("\n");
    return `*${when}*\n${links}`;
  });
  return ["*Recent digests*", ...blocks].join("\n\n");
}
