import OpenAI from "openai";
import { config } from "../config.js";

export const groq = new OpenAI({
  apiKey: config.groqApiKey,
  baseURL: config.groqBaseUrl,
});

export async function chat(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const r = await groq.chat.completions.create({
    model: config.groqModel,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 800,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return r.choices[0]?.message?.content?.trim() ?? "";
}
