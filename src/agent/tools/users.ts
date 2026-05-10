import { db, persist } from "../../store/db.js";
import type { UserPref } from "../../store/types.js";
import { isValidTimezone, nowIso } from "../../util/time.js";
import { getOrCreateGroup } from "./settings.js";

export async function getUserPref(jid: string): Promise<UserPref | null> {
  const d = await db();
  return d.data.users.find((u) => u.jid === jid) ?? null;
}

/**
 * Effective timezone for a user: their saved preference, falling back to the
 * group's digest timezone. Used for reminder parsing and clock queries.
 */
export async function getUserTimezone(userJid: string, groupJid: string): Promise<string> {
  const pref = await getUserPref(userJid);
  if (pref?.timezone) return pref.timezone;
  const g = await getOrCreateGroup(groupJid);
  return g.timezone;
}

export async function setUserTimezone(
  jid: string,
  tz: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isValidTimezone(tz)) {
    return {
      ok: false,
      message: `Invalid IANA timezone: ${tz}. Try e.g. Asia/Kolkata, Europe/London, America/New_York.`,
    };
  }
  const d = await db();
  let u = d.data.users.find((x) => x.jid === jid);
  if (!u) {
    u = { jid, timezone: tz, updatedAt: nowIso() };
    d.data.users.push(u);
  } else {
    u.timezone = tz;
    u.updatedAt = nowIso();
  }
  await persist();
  return { ok: true, message: `Your timezone is set to *${tz}*. Reminders and clock queries will use it.` };
}
