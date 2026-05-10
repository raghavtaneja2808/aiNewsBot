import OpenAI from "openai";
import { config } from "../config.js";
import { log } from "../util/log.js";

/**
 * Groq-powered narration. Fires a tiny chat call to produce a one-line "this is
 * what I'm doing right now" status message — used while a long Venice tool call
 * is in flight so the user doesn't sit staring at silence.
 *
 * Disabled if GROQ_API_KEY is empty.
 */

const groq: OpenAI | null = config.groqApiKey
  ? new OpenAI({ apiKey: config.groqApiKey, baseURL: config.groqBaseUrl })
  : null;

const SYSTEM = [
  "You write a single-line WhatsApp status update for a chat bot that is mid-task.",
  "STRICT RULES — output ONE line only, max 7 words, present continuous tense.",
  "It must read like a casual human assistant, not an AI.",
  "Do NOT use: 'I', 'let me', 'I'll', 'sure', 'okay', greetings, promises, sign-offs, quotes.",
  "Do NOT explain why or what comes next.",
  "An ellipsis at the end is encouraged.",
  "Optionally start with one relevant emoji.",
  "Examples (style only):",
  "- 🔎 pulling latest headlines…",
  "- ⏰ setting that reminder…",
  "- 📰 fetching the article…",
  "- 🌐 looking that up…",
  "- 🗓️ checking your timezone…",
].join("\n");

/** Best-effort one-line narration for a tool call. Returns null on failure / disabled. */
export async function narrate(toolName: string, toolArgs: unknown): Promise<string | null> {
  if (!groq) return null;
  try {
    const argSnippet = JSON.stringify(toolArgs ?? {}).slice(0, 240);
    const r = await groq.chat.completions.create({
      model: config.groqNarrationModel,
      temperature: 0.5,
      max_tokens: 24,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Tool: ${toolName}\nArgs: ${argSnippet}` },
      ],
    });
    let line = (r.choices[0]?.message?.content ?? "").trim();
    if (!line) return null;
    // Strip wrapping quotes if the model added any, and clamp length.
    line = line.replace(/^["'`]+|["'`]+$/g, "").trim();
    if (line.length > 60) line = line.slice(0, 57) + "…";
    return line;
  } catch (err) {
    log.warn({ err: String(err), toolName }, "narrate.failed");
    return null;
  }
}
