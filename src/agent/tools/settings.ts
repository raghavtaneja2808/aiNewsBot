import { db, persist } from "../../store/db.js";
import type { GroupConfig } from "../../store/types.js";
import { config } from "../../config.js";
import { isValidHHMM, isValidTimezone, nowIso } from "../../util/time.js";

export async function getOrCreateGroup(jid: string): Promise<GroupConfig> {
  const d = await db();
  let g = d.data.groups.find((x) => x.jid === jid);
  if (!g) {
    g = {
      jid,
      timezone: config.defaultTimezone,
      digestTimes: [...config.defaultDigestTimes],
      paused: false,
      topics: [],
      createdAt: nowIso(),
    };
    d.data.groups.push(g);
    await persist();
  }
  return g;
}

export async function getGroup(jid: string): Promise<GroupConfig | null> {
  const d = await db();
  return d.data.groups.find((x) => x.jid === jid) ?? null;
}

export async function listGroups(): Promise<GroupConfig[]> {
  const d = await db();
  return [...d.data.groups];
}

export async function setTimezone(jid: string, tz: string): Promise<{ ok: boolean; message: string }> {
  if (!isValidTimezone(tz)) {
    return { ok: false, message: `Invalid IANA timezone: ${tz}. Try e.g. Asia/Kolkata, Europe/London, America/New_York.` };
  }
  const g = await getOrCreateGroup(jid);
  g.timezone = tz;
  await persist();
  return { ok: true, message: `Timezone set to ${tz}.` };
}

export async function setDigestTimes(jid: string, times: string[]): Promise<{ ok: boolean; message: string }> {
  if (times.length === 0) return { ok: false, message: "Provide at least one HH:MM time." };
  for (const t of times) {
    if (!isValidHHMM(t)) return { ok: false, message: `Invalid time: ${t}. Use 24h HH:MM.` };
  }
  const g = await getOrCreateGroup(jid);
  g.digestTimes = [...new Set(times)].sort();
  await persist();
  return { ok: true, message: `Digest times set to ${g.digestTimes.join(", ")} (${g.timezone}).` };
}

export async function pause(jid: string): Promise<string> {
  const g = await getOrCreateGroup(jid);
  g.paused = true;
  await persist();
  return "Daily digests paused. Send /start (or just say \"resume updates\") to turn them back on.";
}

export async function resume(jid: string): Promise<string> {
  const g = await getOrCreateGroup(jid);
  g.paused = false;
  await persist();
  return `Daily digests resumed. Next digests at ${g.digestTimes.join(", ")} ${g.timezone}.`;
}

export async function addTopic(jid: string, topic: string): Promise<string> {
  const t = topic.trim().toLowerCase();
  if (!t) return "Empty topic.";
  const g = await getOrCreateGroup(jid);
  if (g.topics.includes(t)) return `Topic "${t}" is already on the list.`;
  g.topics.push(t);
  await persist();
  return `Added topic "${t}". Current topics: ${g.topics.join(", ")}`;
}

export async function removeTopic(jid: string, topic: string): Promise<string> {
  const t = topic.trim().toLowerCase();
  const g = await getOrCreateGroup(jid);
  const before = g.topics.length;
  g.topics = g.topics.filter((x) => x !== t);
  await persist();
  if (g.topics.length === before) return `Topic "${t}" was not on the list.`;
  return `Removed "${t}". Current topics: ${g.topics.length ? g.topics.join(", ") : "(none — generic AI news)"}`;
}

export async function listTopics(jid: string): Promise<string> {
  const g = await getOrCreateGroup(jid);
  if (!g.topics.length) return "No topics set — digests cover generic AI news.";
  return `Topics: ${g.topics.join(", ")}`;
}

export function formatSettings(g: GroupConfig): string {
  return [
    "*Group settings*",
    `• Timezone: ${g.timezone}`,
    `• Digest times: ${g.digestTimes.join(", ")}`,
    `• Status: ${g.paused ? "paused ⏸️" : "active ▶️"}`,
    `• Topics: ${g.topics.length ? g.topics.join(", ") : "(generic AI news)"}`,
  ].join("\n");
}
