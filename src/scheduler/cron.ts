import cron, { type ScheduledTask } from "node-cron";
import { log } from "../util/log.js";
import { runDigest } from "../agent/tools/digest.js";
import { sendText } from "../whatsapp/send.js";
import { getGroup, listGroups } from "../agent/tools/settings.js";
import { isGroupAllowed } from "../whatsapp/allowlist.js";

/** jid -> array of scheduled tasks (one per digest time) */
const jobs = new Map<string, ScheduledTask[]>();

function clearJobsFor(jid: string): void {
  const existing = jobs.get(jid);
  if (!existing) return;
  for (const t of existing) {
    try {
      t.stop();
    } catch (err) {
      log.warn({ err: String(err) }, "cron.stop failed");
    }
  }
  jobs.delete(jid);
}

async function fireDigest(jid: string): Promise<void> {
  const g = await getGroup(jid);
  if (!g) return;
  if (g.paused) {
    log.info({ jid }, "cron.skip_paused");
    return;
  }
  log.info({ jid }, "cron.fire_digest");
  try {
    const r = await runDigest(jid);
    if (r.text) await sendText(jid, r.text);
  } catch (err) {
    log.error({ err: String(err), jid }, "cron.digest_failed");
    await sendText(jid, "I tried to run today's digest but hit an error. I'll try again at the next slot.").catch(() => {});
  }
}

export async function rescheduleGroup(jid: string): Promise<void> {
  clearJobsFor(jid);
  if (!(await isGroupAllowed(jid))) {
    log.info({ jid }, "cron.skip_not_allowlisted");
    return;
  }
  const g = await getGroup(jid);
  if (!g) return;

  const tasks: ScheduledTask[] = [];
  for (const t of g.digestTimes) {
    const [hh, mm] = t.split(":");
    const expr = `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * *`;
    try {
      const task = cron.schedule(expr, () => void fireDigest(jid), {
        timezone: g.timezone,
      });
      tasks.push(task);
      log.info({ jid, expr, timezone: g.timezone }, "cron.scheduled");
    } catch (err) {
      log.error({ err: String(err), jid, expr, timezone: g.timezone }, "cron.schedule_failed");
    }
  }
  jobs.set(jid, tasks);
}

export async function scheduleAllGroups(): Promise<void> {
  const groups = await listGroups();
  for (const g of groups) {
    await rescheduleGroup(g.jid);
  }
  log.info({ count: groups.length }, "cron.bootstrap_done");
}
