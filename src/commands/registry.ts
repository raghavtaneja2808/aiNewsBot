import { parseCommand } from "./parse.js";
import { helpText } from "./help.js";
import { runDigest } from "../agent/tools/digest.js";
import { summarizeUrl } from "../agent/tools/summarize.js";
import {
  formatRemindersList,
  setReminder,
  cancelReminder,
} from "../agent/tools/reminders.js";
import {
  formatSettings,
  getOrCreateGroup,
  setDigestTimes,
  setTimezone,
  pause,
  resume,
  addTopic,
  removeTopic,
  listTopics,
} from "../agent/tools/settings.js";
import { formatHistory } from "../agent/tools/history.js";
import { rescheduleGroup } from "../scheduler/cron.js";
import { runAgent } from "../agent/agent.js";
import { setUserTimezone, getUserTimezone } from "../agent/tools/users.js";

export type CmdCtx = { groupJid: string; userJid: string };

export function isCommand(text: string): boolean {
  return text.trim().startsWith("/");
}

export async function runCommand(text: string, ctx: CmdCtx): Promise<string> {
  const cmd = parseCommand(text);
  if (!cmd) return "Couldn't parse that command. Try /help.";

  switch (cmd.name) {
    case "help":
      return helpText();

    case "news": {
      const r = await runDigest(ctx.groupJid);
      return r.text;
    }

    case "summarize": {
      const url = cmd.args[0];
      if (!url || !/^https?:\/\//.test(url)) return "Usage: /summarize <url>";
      const r = await summarizeUrl(url);
      return `*${r.title}*\n${r.summary}\n${r.url}`;
    }

    case "history":
      return formatHistory(ctx.groupJid, 5);

    case "set-timezone":
    case "settimezone":
    case "tz":
    case "my-timezone": {
      const tz = cmd.args[0];
      if (!tz) return "Usage: /set-timezone <IANA>  (e.g. Asia/Kolkata) — sets *your* timezone for reminders & clock.";
      const r = await setUserTimezone(ctx.userJid, tz);
      return r.message;
    }

    case "digest-timezone":
    case "digesttimezone": {
      const tz = cmd.args[0];
      if (!tz) return "Usage: /digest-timezone <IANA>  — sets the timezone the *daily digest* schedule runs in (group-wide).";
      const r = await setTimezone(ctx.groupJid, tz);
      if (r.ok) await rescheduleGroup(ctx.groupJid);
      return r.message;
    }

    case "digest-times":
    case "digesttimes": {
      if (cmd.args.length < 1) return "Usage: /digest-times HH:MM [HH:MM ...]";
      const r = await setDigestTimes(ctx.groupJid, cmd.args);
      if (r.ok) await rescheduleGroup(ctx.groupJid);
      return r.message;
    }

    case "stop":
    case "pause":
      return pause(ctx.groupJid);

    case "start":
    case "resume":
      return resume(ctx.groupJid);

    case "topics": {
      const sub = (cmd.args[0] ?? "list").toLowerCase();
      const rest = cmd.args.slice(1).join(" ").trim();
      if (sub === "list" || sub === "") return listTopics(ctx.groupJid);
      if (sub === "add") {
        if (!rest) return "Usage: /topics add <topic>";
        return addTopic(ctx.groupJid, rest);
      }
      if (sub === "remove" || sub === "rm" || sub === "del") {
        if (!rest) return "Usage: /topics remove <topic>";
        return removeTopic(ctx.groupJid, rest);
      }
      return "Usage: /topics list | /topics add <topic> | /topics remove <topic>";
    }

    case "remind":
    case "remindme":
    case "set-reminder": {
      // Accept either "/remind <when> <message>" with quoted when, or
      // "/remind <when...> | <message>" as a fallback.
      // Simplest robust split: take the first 1-3 tokens as a time-like prefix
      // until chrono parses it OR we hit a separator. To keep things predictable,
      // require either "in <num><unit> <message>" / "<HH:MM> <message>" /
      // "<word word> | <message>" / ISO + message.
      const parsed = splitWhenAndMessage(cmd.rest);
      if (!parsed) return 'Usage: /remind <when> <message>  e.g. `/remind in 30m drink water` or `/remind 18:30 | call dad`';
      const r = await setReminder(ctx.groupJid, ctx.userJid, parsed.when, parsed.message);
      if (!r.ok) return r.message;
      return `⏰ Reminder *${r.reminder.id}* set for *${r.humanWhen}* — "${r.reminder.message}"`;
    }

    case "reminders":
    case "list-reminders":
      return formatRemindersList(ctx.groupJid);

    case "cancel":
    case "cancel-reminder": {
      const id = cmd.args[0];
      if (!id) return "Usage: /cancel <id>";
      const r = await cancelReminder(ctx.groupJid, id);
      return r.message;
    }

    case "settings": {
      const g = await getOrCreateGroup(ctx.groupJid);
      const userTz = await getUserTimezone(ctx.userJid, ctx.groupJid);
      return formatSettings(g) + `\n• Your timezone: ${userTz}`;
    }

    case "ask": {
      if (!cmd.rest) return "Usage: /ask <question>";
      return runAgent(cmd.rest, ctx);
    }

    default:
      return `Unknown command: /${cmd.name}. Send /help.`;
  }
}

/**
 * Split "/remind" rest into when + message. Two supported shapes:
 *   - explicit separator:   "in 30m | drink water"
 *   - implicit:             "in 30m drink water"  (greedy: smallest chrono-parseable prefix)
 */
function splitWhenAndMessage(rest: string): { when: string; message: string } | null {
  if (!rest) return null;
  const sep = rest.indexOf("|");
  if (sep > 0) {
    const when = rest.slice(0, sep).trim();
    const message = rest.slice(sep + 1).trim();
    if (!when || !message) return null;
    return { when, message };
  }
  const tokens = rest.split(/\s+/);
  // Try increasing prefix lengths until chrono parses it.
  // Heuristic only — caller still validates via parseWhen.
  for (let i = Math.min(4, tokens.length); i >= 1; i--) {
    const when = tokens.slice(0, i).join(" ");
    const message = tokens.slice(i).join(" ").trim();
    if (!message) continue;
    return { when, message };
  }
  return null;
}
