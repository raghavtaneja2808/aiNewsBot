import { config } from "../config.js";
import { db, persist } from "../store/db.js";

/**
 * Effective allowlist = static (env ALLOWED_GROUP_JIDS) ∪ runtime (db.enabledGroups).
 * A group is allowed if its JID appears in either source.
 */
export async function isGroupAllowed(jid: string): Promise<boolean> {
  if (!jid.endsWith("@g.us")) return false;
  if (config.allowedGroupJids.includes(jid)) return true;
  const d = await db();
  return d.data.enabledGroups.includes(jid);
}

/** Synchronous variant for hot paths (e.g. cron) — assumes db() has been awaited at boot. */
export function isGroupAllowedSync(jid: string, runtime: string[]): boolean {
  if (!jid.endsWith("@g.us")) return false;
  return config.allowedGroupJids.includes(jid) || runtime.includes(jid);
}

export async function enableGroup(jid: string): Promise<{ alreadyEnabled: boolean }> {
  const d = await db();
  if (d.data.enabledGroups.includes(jid) || config.allowedGroupJids.includes(jid)) {
    return { alreadyEnabled: true };
  }
  d.data.enabledGroups.push(jid);
  await persist();
  return { alreadyEnabled: false };
}

export async function disableGroup(jid: string): Promise<{ wasEnabled: boolean; inEnv: boolean }> {
  const d = await db();
  const inEnv = config.allowedGroupJids.includes(jid);
  const idx = d.data.enabledGroups.indexOf(jid);
  if (idx < 0) return { wasEnabled: false, inEnv };
  d.data.enabledGroups.splice(idx, 1);
  await persist();
  return { wasEnabled: true, inEnv };
}
