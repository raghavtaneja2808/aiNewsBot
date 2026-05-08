import { log } from "../util/log.js";
import { dueReminders, markFired } from "../agent/tools/reminders.js";
import { sendText } from "../whatsapp/send.js";

const TICK_MS = 30_000;

let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    const due = await dueReminders();
    for (const r of due) {
      const tag = r.userJid ? `@${r.userJid.split("@")[0]} ` : "";
      const text = `⏰ Reminder ${tag}— ${r.message}`;
      try {
        await sendText(r.groupJid, text);
        await markFired(r.id);
      } catch (err) {
        log.error({ err: String(err), id: r.id }, "tick.send_failed");
        // Don't mark fired on send failure — try again next tick.
      }
    }
  } catch (err) {
    log.error({ err: String(err) }, "tick.error");
  }
}

export function startTick(): void {
  if (timer) return;
  // Fire one immediately so freshly-due reminders don't wait a tick.
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
}

export function stopTick(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
