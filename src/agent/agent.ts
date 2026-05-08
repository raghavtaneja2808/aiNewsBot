import {
  Agent,
  run,
  tool,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from "@openai/agents";
import { z } from "zod";
import { config } from "../config.js";
import { groq } from "./groqClient.js";
import { log } from "../util/log.js";

import { runDigest } from "./tools/digest.js";
import { summarizeUrl } from "./tools/summarize.js";
import { searchNews } from "./tools/searchNews.js";
import {
  setReminder,
  formatRemindersList,
  cancelReminder,
} from "./tools/reminders.js";
import {
  getOrCreateGroup,
  setTimezone,
  setDigestTimes,
  pause,
  resume,
  addTopic,
  removeTopic,
  listTopics,
  formatSettings,
} from "./tools/settings.js";
import { formatHistory } from "./tools/history.js";
import { rescheduleGroup } from "../scheduler/cron.js";

// --- One-time SDK setup so it talks to Groq's OpenAI-compatible API ---
setDefaultOpenAIClient(groq as any);
setOpenAIAPI("chat_completions");
setTracingDisabled(true);

export type AgentCtx = {
  groupJid: string;
  userJid: string;
};

const SYSTEM_PROMPT = `You are AINewsBot, a WhatsApp assistant living inside a group chat.

Your jobs, in order:
1. Twice a day you proactively post an AI-news digest (the schedule is handled outside of you — don't promise to "send one later", call run_digest if the user wants one *now*).
2. You answer questions and run small tasks (reminders, URL summaries, settings) by calling tools.

Style:
- This is WhatsApp. Be concise. No headings unless needed. Use *bold* and _italic_ — those render. Don't use markdown tables or code fences.
- When you don't know, say so. Never invent URLs or facts.
- Prefer calling a tool over guessing. If a user says something like "remind me at 6", call set_reminder. If they say "what's new in AI", call run_digest.
- After a tool runs, write a *short* natural reply that incorporates its result. Don't echo the raw JSON back.

Permission model:
- Anyone in the group can run any tool. There is no admin gate.

Time:
- The current group's timezone is provided in the user message header. All reminder times you pass to set_reminder should be the user's wording — set_reminder will parse it against the group's timezone.

If the user just sends a greeting or chit-chat, respond briefly without calling tools.`;

const t_runDigest = tool({
  name: "run_digest",
  description: "Run a fresh AI news digest now and send it to the group. Use when the user asks for the latest news, today's AI updates, or just says 'news'.",
  parameters: z.object({}),
  execute: async (_input, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const r = await runDigest(ctx.groupJid);
    return { stories: r.stories.length, text: r.text };
  },
});

const t_summarizeUrl = tool({
  name: "summarize_url",
  description: "Fetch a URL and return a short bullet summary.",
  parameters: z.object({ url: z.string().describe("Absolute http(s) URL") }),
  execute: async ({ url }) => summarizeUrl(url),
});

const t_searchNews = tool({
  name: "search_news",
  description: "Run a Google news search and return the top results (title, url, snippet). Use this when the user asks about a specific story or topic.",
  parameters: z.object({
    query: z.string(),
    num: z.number().int().min(1).max(10).default(5),
  }),
  execute: async ({ query, num }) => {
    const r = await searchNews(query, num);
    return r.slice(0, num);
  },
});

const t_setReminder = tool({
  name: "set_reminder",
  description: "Schedule a reminder. 'when' may be natural language ('in 30m', 'tomorrow 9am') or ISO. The group's configured timezone is applied automatically.",
  parameters: z.object({
    when: z.string(),
    message: z.string(),
  }),
  execute: async ({ when, message }, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    return setReminder(ctx.groupJid, ctx.userJid, when, message);
  },
});

const t_listReminders = tool({
  name: "list_reminders",
  description: "List pending reminders in this group.",
  parameters: z.object({}),
  execute: async (_input, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    return formatRemindersList(ctx.groupJid);
  },
});

const t_cancelReminder = tool({
  name: "cancel_reminder",
  description: "Cancel a reminder by its short id.",
  parameters: z.object({ id: z.string() }),
  execute: async ({ id }, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    return cancelReminder(ctx.groupJid, id);
  },
});

const t_getSettings = tool({
  name: "get_settings",
  description: "Return current group config (timezone, digest times, paused, topics).",
  parameters: z.object({}),
  execute: async (_input, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const g = await getOrCreateGroup(ctx.groupJid);
    return { config: g, formatted: formatSettings(g) };
  },
});

const t_setTimezone = tool({
  name: "set_timezone",
  description: "Set the group's IANA timezone (e.g. Asia/Kolkata, Europe/London).",
  parameters: z.object({ timezone: z.string() }),
  execute: async ({ timezone }, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const r = await setTimezone(ctx.groupJid, timezone);
    if (r.ok) await rescheduleGroup(ctx.groupJid);
    return r;
  },
});

const t_setDigestTimes = tool({
  name: "set_digest_times",
  description: "Set the daily digest times for this group as 24h HH:MM strings.",
  parameters: z.object({ times: z.array(z.string()).min(1) }),
  execute: async ({ times }, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const r = await setDigestTimes(ctx.groupJid, times);
    if (r.ok) await rescheduleGroup(ctx.groupJid);
    return r;
  },
});

const t_pause = tool({
  name: "pause_digests",
  description: "Pause daily digests in this group.",
  parameters: z.object({}),
  execute: async (_input, runCtx) => pause(((runCtx as any).context as AgentCtx).groupJid),
});

const t_resume = tool({
  name: "resume_digests",
  description: "Resume daily digests in this group.",
  parameters: z.object({}),
  execute: async (_input, runCtx) => resume(((runCtx as any).context as AgentCtx).groupJid),
});

const t_addTopic = tool({
  name: "add_topic",
  description: "Add a topic to bias future digests (e.g. 'agents', 'robotics', 'regulation').",
  parameters: z.object({ topic: z.string() }),
  execute: async ({ topic }, runCtx) => addTopic(((runCtx as any).context as AgentCtx).groupJid, topic),
});

const t_removeTopic = tool({
  name: "remove_topic",
  description: "Remove a topic from this group's filter.",
  parameters: z.object({ topic: z.string() }),
  execute: async ({ topic }, runCtx) => removeTopic(((runCtx as any).context as AgentCtx).groupJid, topic),
});

const t_listTopics = tool({
  name: "list_topics",
  description: "Show the topic filter for this group.",
  parameters: z.object({}),
  execute: async (_input, runCtx) => listTopics(((runCtx as any).context as AgentCtx).groupJid),
});

const t_history = tool({
  name: "get_history",
  description: "Show the last few digests sent to this group.",
  parameters: z.object({ n: z.number().int().min(1).max(10).default(5) }),
  execute: async ({ n }, runCtx) => formatHistory(((runCtx as any).context as AgentCtx).groupJid, n),
});

const t_now = tool({
  name: "get_current_time",
  description: "Return the current time in the group's configured timezone.",
  parameters: z.object({}),
  execute: async (_input, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const g = await getOrCreateGroup(ctx.groupJid);
    return {
      timezone: g.timezone,
      now: new Date().toLocaleString("en-GB", { timeZone: g.timezone }),
    };
  },
});

const agent = new Agent<AgentCtx>({
  name: "AINewsBot",
  model: config.groqModel,
  instructions: SYSTEM_PROMPT,
  tools: [
    t_runDigest,
    t_summarizeUrl,
    t_searchNews,
    t_setReminder,
    t_listReminders,
    t_cancelReminder,
    t_getSettings,
    t_setTimezone,
    t_setDigestTimes,
    t_pause,
    t_resume,
    t_addTopic,
    t_removeTopic,
    t_listTopics,
    t_history,
    t_now,
  ],
});

export async function runAgent(input: string, ctx: AgentCtx): Promise<string> {
  const g = await getOrCreateGroup(ctx.groupJid);
  const header = `[group_tz=${g.timezone} paused=${g.paused} topics=${g.topics.join("|") || "-"}]`;
  const wrapped = `${header}\nUser: ${input}`;

  log.debug({ ctx, input }, "agent.run");

  try {
    const result = await run(agent, wrapped, { context: ctx, maxTurns: 8 });
    const out = (result.finalOutput ?? "").toString().trim();
    return out || "(no response)";
  } catch (err) {
    log.error({ err: String(err) }, "agent.error");
    return "Sorry — I hit an error processing that. Try again, or use a slash command (send /help).";
  }
}
