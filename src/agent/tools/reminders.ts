import { db, persist } from "../../store/db.js";
import type { Reminder } from "../../store/types.js";
import { formatInTz, nowIso, parseWhen, shortId } from "../../util/time.js";
import { getOrCreateGroup } from "./settings.js";

export type SetReminderResult =
  | { ok: true; reminder: Reminder; humanWhen: string }
  | { ok: false; message: string };

export async function setReminder(
  groupJid: string,
  userJid: string,
  when: string,
  message: string,
): Promise<SetReminderResult> {
  if (!message?.trim()) return { ok: false, message: "Reminder needs a message." };
  const g = await getOrCreateGroup(groupJid);
  const fireAtIso = parseWhen(when, g.timezone);
  if (!fireAtIso) return { ok: false, message: `Couldn't understand the time "${when}". Try "in 30m", "tomorrow 9am", or "2026-05-09 14:00".` };
  if (new Date(fireAtIso).getTime() <= Date.now()) {
    return { ok: false, message: "That time is in the past." };
  }

  const r: Reminder = {
    id: shortId("r"),
    groupJid,
    userJid,
    fireAt: fireAtIso,
    message: message.trim(),
    status: "pending",
    createdAt: nowIso(),
  };

  const d = await db();
  d.data.reminders.push(r);
  await persist();

  return { ok: true, reminder: r, humanWhen: formatInTz(fireAtIso, g.timezone) + " " + g.timezone };
}

export async function listReminders(groupJid: string): Promise<Reminder[]> {
  const d = await db();
  return d.data.reminders
    .filter((r) => r.groupJid === groupJid && r.status === "pending")
    .sort((a, b) => a.fireAt.localeCompare(b.fireAt));
}

export async function cancelReminder(groupJid: string, id: string): Promise<{ ok: boolean; message: string }> {
  const d = await db();
  const r = d.data.reminders.find((x) => x.id === id && x.groupJid === groupJid);
  if (!r) return { ok: false, message: `No reminder with id ${id} in this group.` };
  if (r.status !== "pending") return { ok: false, message: `Reminder ${id} is already ${r.status}.` };
  r.status = "cancelled";
  await persist();
  return { ok: true, message: `Cancelled reminder ${id}.` };
}

export async function dueReminders(now: Date = new Date()): Promise<Reminder[]> {
  const d = await db();
  const cutoff = now.toISOString();
  return d.data.reminders.filter((r) => r.status === "pending" && r.fireAt <= cutoff);
}

export async function markFired(id: string): Promise<void> {
  const d = await db();
  const r = d.data.reminders.find((x) => x.id === id);
  if (r) {
    r.status = "fired";
    await persist();
  }
}

export async function formatRemindersList(groupJid: string): Promise<string> {
  const list = await listReminders(groupJid);
  if (!list.length) return "No pending reminders.";
  const g = await getOrCreateGroup(groupJid);
  const lines = list.map((r) => `• \`${r.id}\` — ${formatInTz(r.fireAt, g.timezone)} ${g.timezone} — ${r.message}`);
  return ["*Pending reminders*", ...lines].join("\n");
}
