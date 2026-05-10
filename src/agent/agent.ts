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
import { llmAgent } from "./llmClient.js";
import { log } from "../util/log.js";

import { runDigest } from "./tools/digest.js";
import { summarizeUrl } from "./tools/summarize.js";
import { searchNews } from "./tools/searchNews.js";
import { deepSearch } from "./tools/deepSearch.js";
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
import { setUserTimezone, getUserTimezone } from "./tools/users.js";
import { getRecentMessages } from "../store/messages.js";
import { narrate } from "./narrate.js";
import { sendText, setTyping } from "../whatsapp/send.js";

// --- One-time SDK setup so it talks to Groq's OpenAI-compatible API ---
setDefaultOpenAIClient(llmAgent as any);
setOpenAIAPI("chat_completions");
setTracingDisabled(true);

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

/**
 * Wraps a tool's execute() so the FIRST tool call in a single agent run posts
 * a brief Groq-generated narration ("🔎 pulling latest headlines…") to the
 * chat. Subsequent tool calls in the same run stay silent — one narration per
 * turn, no spam. No-op when GROQ_API_KEY is empty (narrate() returns null).
 *
 * Fire-and-forget: the narration send doesn't block the actual tool.
 */
function withN<I, R>(
  toolName: string,
  fn: (input: I, runCtx: any) => R | Promise<R>,
): (input: I, runCtx: any) => Promise<R> {
  return async (input: I, runCtx: any) => {
    const ctx = runCtx?.context as AgentCtx | undefined;
    const argSnippet = JSON.stringify(input ?? {}).slice(0, 200);
    log.info({ tool: toolName, args: argSnippet, narrated: !!ctx?._narrated }, "agent.tool_call");

    if (ctx && !ctx._narrated) {
      ctx._narrated = true;
      void (async () => {
        const line = await narrate(toolName, input);
        if (!line) return;
        log.info({ tool: toolName, line }, "agent.narration");
        await sendText(ctx.groupJid, line).catch(() => {});
        await setTyping(ctx.groupJid, true).catch(() => {});
      })();
    }

    const t0 = Date.now();
    try {
      const result = await fn(input, runCtx);
      log.info({ tool: toolName, ms: Date.now() - t0, ok: true }, "agent.tool_done");
      return result;
    } catch (err) {
      log.error({ tool: toolName, ms: Date.now() - t0, err: String(err) }, "agent.tool_done");
      throw err;
    }
  };
}

export type AgentCtx = {
  groupJid: string;
  userJid: string;
  /** Mutable per-run flag: true once we've fired a narration for this turn,
   *  so the user doesn't get spammed when the agent calls multiple tools. */
  _narrated?: boolean;
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

CRITICAL — no intent-announcing:
- NEVER reply with text like "I'll search…", "Let me look that up…", "I'll do a deeper search…", "Sure, give me a moment…", or any other promise to use a tool. Either CALL the tool right now in this same turn, or answer the question directly. Never both, never neither.
- If you find yourself about to write "I'll" or "let me" followed by a verb, STOP and emit the tool call instead. The user can see a separate "doing X" indicator already; your reply must contain the actual answer or the actual tool call, not a promise.
- If a previous turn promised work that wasn't done, don't apologize and re-promise. Just do it now (call the tool) and reply with the result.

Web search — you have THREE search paths, in order of preference:

1. **Built-in (Venice) web search** — enabled by default on every turn. For ad-hoc questions about current events, prices, or anything time-sensitive, just answer using it. No tool call needed. This is your default.

2. **deep_search tool (SerpAPI broad)** — call this when:
   - the user uses words like "deep search", "search harder", "search more thoroughly", "dig deeper", "look more carefully", "find more", "find better sources";
   - your built-in answer above feels thin/uncertain or you couldn't find the info;
   - the topic is niche/technical/historical (built-in search is biased toward fresh popular content);
   - you need older information (built-in defaults to recent).
   After deep_search returns, you may follow up with summarize_url on the most promising result(s) for the full text.

3. **search_news tool (SerpAPI past-24h news)** — call this for *fresh news on a specific story* (different from the daily digest, which is what run_digest is for).

When you use web sources, include 1–3 short URLs at the end on their own line, prefixed with "🔗". Don't fabricate URLs — only use ones the search actually returned.

Permission model:
- Anyone in the group can run any tool. There is no admin gate.

Time:
- The header on each user message includes \`user_tz\` (the asker's personal timezone, used for reminders and clock) and \`group_digest_tz\` (the timezone the daily digest is scheduled in).
- If a user asks "what's my timezone?" or "what time is it?", use \`user_tz\`.
- For reminders, just pass the user's wording — set_reminder uses the asker's timezone automatically.
- If a user wants to *change their own* timezone, call \`set_timezone\` (per-user). If they explicitly want to change the *digest schedule's* timezone for the whole group, call \`set_digest_timezone\`.

Conversation memory:
- Each user message arrives with a "--- recent group conversation ---" block containing the last messages in this WhatsApp group (oldest first), each tagged with timestamp, sender, and text. Bot's own past replies are tagged "Bot".
- Use this block to resolve references like "the second one", "what we were just discussing", or "remind me about that". When the context is ambiguous, ask a short clarifying question instead of guessing.
- Don't summarize the conversation back at the user unless they ask.

If the user just sends a greeting or chit-chat, respond briefly without calling tools.`;

const t_runDigest = tool({
  name: "run_digest",
  description: "Run a fresh AI news digest now and send it to the group. Use when the user asks for the latest news, today's AI updates, or just says 'news'.",
  parameters: z.object({}),
  execute: withN("run_digest", async (_input, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const r = await runDigest(ctx.groupJid);
    return { stories: r.stories.length, text: r.text };
  }),
});

const t_summarizeUrl = tool({
  name: "summarize_url",
  description: "Fetch a URL and return a short bullet summary.",
  parameters: z.object({ url: z.string().describe("Absolute http(s) URL") }),
  execute: withN("summarize_url", async ({ url }) => summarizeUrl(url)),
});

const t_deepSearch = tool({
  name: "deep_search",
  description:
    "Broad Google web search via SerpAPI. Reach for this when:\n" +
    "  - the user explicitly says 'deep search', 'search harder', 'look more carefully', 'dig deeper', or similar;\n" +
    "  - your built-in web search returned thin/irrelevant results;\n" +
    "  - the topic is niche, technical, historical, or from a small site Venice is unlikely to surface.\n" +
    "Returns title, url, snippet for ~10 organic results across distinct domains. " +
    "Follow up with summarize_url on the most promising result(s) if you need the full article text.",
  parameters: z.object({
    query: z.string(),
    num: z.string().describe("How many results to return, 1-15. Default 10.").default("10"),
  }),
  execute: withN("deep_search", async ({ query, num }) => {
    const n = clampInt(num, 1, 15, 10);
    const r = await deepSearch(query, n);
    return r.slice(0, n);
  }),
});

const t_searchNews = tool({
  name: "search_news",
  description: "Run a Google news search (past 24h) and return the top results (title, url, snippet). Use this for fresh news on a specific story or topic. For broader/older searches, use deep_search.",
  // Note: `num` is declared as a string because Llama-family models on Groq commonly
  // serialize numbers as strings in tool calls and Groq enforces strict schema validation.
  // We coerce inside the handler.
  parameters: z.object({
    query: z.string(),
    num: z.string().describe("How many results to return, 1-10. Default 5.").default("5"),
  }),
  execute: withN("search_news", async ({ query, num }) => {
    const n = clampInt(num, 1, 10, 5);
    const r = await searchNews(query, n);
    return r.slice(0, n);
  }),
});

const t_setReminder = tool({
  name: "set_reminder",
  description: "Schedule a reminder. 'when' may be natural language ('in 30m', 'tomorrow 9am') or ISO. The group's configured timezone is applied automatically.",
  parameters: z.object({
    when: z.string(),
    message: z.string(),
  }),
  execute: withN("set_reminder", async ({ when, message }, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    return setReminder(ctx.groupJid, ctx.userJid, when, message);
  }),
});

const t_listReminders = tool({
  name: "list_reminders",
  description: "List pending reminders in this group.",
  parameters: z.object({}),
  execute: withN("list_reminders", async (_input, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    return formatRemindersList(ctx.groupJid);
  }),
});

const t_cancelReminder = tool({
  name: "cancel_reminder",
  description: "Cancel a reminder by its short id.",
  parameters: z.object({ id: z.string() }),
  execute: withN("cancel_reminder", async ({ id }, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    return cancelReminder(ctx.groupJid, id);
  }),
});

const t_getSettings = tool({
  name: "get_settings",
  description: "Return current group config (timezone, digest times, paused, topics).",
  parameters: z.object({}),
  execute: withN("get_settings", async (_input, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const g = await getOrCreateGroup(ctx.groupJid);
    return { config: g, formatted: formatSettings(g) };
  }),
});

const t_setTimezone = tool({
  name: "set_timezone",
  description: "Set THE CALLING USER's IANA timezone (e.g. Asia/Kolkata, Europe/London). Affects only their reminders and clock — does NOT change the digest schedule.",
  parameters: z.object({ timezone: z.string() }),
  execute: withN("set_timezone", async ({ timezone }, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    return setUserTimezone(ctx.userJid, timezone);
  }),
});

const t_setDigestTimezone = tool({
  name: "set_digest_timezone",
  description: "Set the GROUP-WIDE timezone used for the daily digest schedule. Use only when the user explicitly wants to change when the digest fires for everyone.",
  parameters: z.object({ timezone: z.string() }),
  execute: withN("set_digest_timezone", async ({ timezone }, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const r = await setTimezone(ctx.groupJid, timezone);
    if (r.ok) await rescheduleGroup(ctx.groupJid);
    return r;
  }),
});

const t_setDigestTimes = tool({
  name: "set_digest_times",
  description: "Set the daily digest times for this group as 24h HH:MM strings.",
  parameters: z.object({ times: z.array(z.string()).min(1) }),
  execute: withN("set_digest_times", async ({ times }, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const r = await setDigestTimes(ctx.groupJid, times);
    if (r.ok) await rescheduleGroup(ctx.groupJid);
    return r;
  }),
});

const t_pause = tool({
  name: "pause_digests",
  description: "Pause daily digests in this group.",
  parameters: z.object({}),
  execute: withN("pause_digests", async (_input, runCtx) => pause(((runCtx as any).context as AgentCtx).groupJid)),
});

const t_resume = tool({
  name: "resume_digests",
  description: "Resume daily digests in this group.",
  parameters: z.object({}),
  execute: withN("resume_digests", async (_input, runCtx) => resume(((runCtx as any).context as AgentCtx).groupJid)),
});

const t_addTopic = tool({
  name: "add_topic",
  description: "Add a topic to bias future digests (e.g. 'agents', 'robotics', 'regulation').",
  parameters: z.object({ topic: z.string() }),
  execute: withN("add_topic", async ({ topic }, runCtx) => addTopic(((runCtx as any).context as AgentCtx).groupJid, topic)),
});

const t_removeTopic = tool({
  name: "remove_topic",
  description: "Remove a topic from this group's filter.",
  parameters: z.object({ topic: z.string() }),
  execute: withN("remove_topic", async ({ topic }, runCtx) => removeTopic(((runCtx as any).context as AgentCtx).groupJid, topic)),
});

const t_listTopics = tool({
  name: "list_topics",
  description: "Show the topic filter for this group.",
  parameters: z.object({}),
  execute: withN("list_topics", async (_input, runCtx) => listTopics(((runCtx as any).context as AgentCtx).groupJid)),
});

const t_history = tool({
  name: "get_history",
  description: "Show the last few digests sent to this group.",
  parameters: z.object({
    n: z.string().describe("How many recent digests to show, 1-10. Default 5.").default("5"),
  }),
  execute: withN("get_history", async ({ n }, runCtx) =>
    formatHistory(((runCtx as any).context as AgentCtx).groupJid, clampInt(n, 1, 10, 5))),
});

const t_now = tool({
  name: "get_current_time",
  description: "Return the current time in the asking user's timezone.",
  parameters: z.object({}),
  execute: withN("get_current_time", async (_input, runCtx) => {
    const ctx = (runCtx as any).context as AgentCtx;
    const tz = await getUserTimezone(ctx.userJid, ctx.groupJid);
    return {
      timezone: tz,
      now: new Date().toLocaleString("en-GB", { timeZone: tz }),
    };
  }),
});

const agent = new Agent<AgentCtx>({
  name: "AINewsBot",
  model: config.llmModel,
  instructions: SYSTEM_PROMPT,
  tools: [
    t_runDigest,
    t_summarizeUrl,
    t_searchNews,
    t_deepSearch,
    t_setReminder,
    t_listReminders,
    t_cancelReminder,
    t_getSettings,
    t_setTimezone,
    t_setDigestTimezone,
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

const CONTEXT_MESSAGES = 30;

function shortJid(jid: string): string {
  // Use last 4 chars of the user portion as a stable display tag.
  const user = jid.split("@")[0] ?? jid;
  return `…${user.slice(-4)}`;
}

function formatContext(recent: { senderJid: string; senderName?: string; text: string; ts: number; source: string }[]): string {
  if (!recent.length) return "(no prior messages on record)";
  return recent
    .map((m) => {
      const t = new Date(m.ts).toISOString().replace("T", " ").slice(0, 16);
      const who = m.source === "out" ? "Bot" : (m.senderName || shortJid(m.senderJid));
      return `[${t}] ${who}: ${m.text}`;
    })
    .join("\n");
}

export async function runAgent(input: string, ctx: AgentCtx): Promise<string> {
  const g = await getOrCreateGroup(ctx.groupJid);
  const userTz = await getUserTimezone(ctx.userJid, ctx.groupJid);

  // Last N messages from this group, oldest → newest, including the bot's own replies.
  // The current /ask is NOT in the store yet (router writes happen in parallel),
  // so the last entry is the most recent prior message.
  const recent = await getRecentMessages(ctx.groupJid, CONTEXT_MESSAGES);
  const contextBlock = formatContext(recent);

  const header =
    `[user_tz=${userTz} group_digest_tz=${g.timezone} paused=${g.paused} ` +
    `topics=${g.topics.join("|") || "-"} caller=${shortJid(ctx.userJid)}]`;

  const wrapped =
    `${header}\n\n` +
    `--- recent group conversation (oldest → newest) ---\n` +
    `${contextBlock}\n` +
    `--- end conversation ---\n\n` +
    `Current request from ${shortJid(ctx.userJid)}: ${input}`;

  log.info({ chatJid: ctx.groupJid, userJid: ctx.userJid, input: input.slice(0, 120) }, "agent.run.start");
  const t0 = Date.now();

  try {
    const result = await run(agent, wrapped, { context: ctx, maxTurns: 8 });
    const out = (result.finalOutput ?? "").toString().trim();
    log.info(
      { ms: Date.now() - t0, narrated: !!ctx._narrated, replyLen: out.length },
      "agent.run.done",
    );
    return out || "(no response — the model returned an empty reply)";
  } catch (err) {
    const msg = String((err as any)?.message ?? err);
    log.error({ ms: Date.now() - t0, err: msg }, "agent.error");
    return `⚠️ Agent error: ${msg.slice(0, 280)}`;
  }
}
