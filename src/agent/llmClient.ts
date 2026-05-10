import OpenAI from "openai";
import { config } from "../config.js";

// Provider-neutral OpenAI-compatible client. Currently points at Venice AI,
// but any OpenAI-compatible endpoint works (Groq, Together, Fireworks, etc.) —
// just change LLM_BASE_URL and the model name in .env.
export const llm = new OpenAI({
  apiKey: config.llmApiKey,
  baseURL: config.llmBaseUrl,
});

/**
 * Agent-facing client. Wraps `llm` to inject Venice's web-search add-on on every
 * chat.completions.create call, so the agent's /ask path answers from live web
 * data with citations. The bare `llm` (no web search) is still used for things
 * like article summarization where the prompt already contains all the content.
 *
 * Venice docs: pass `venice_parameters.enable_web_search: "auto" | "on" | "off"`.
 * "auto" lets the model decide per turn — cheapest and least intrusive.
 */
export const llmAgent = new OpenAI({
  apiKey: config.llmApiKey,
  baseURL: config.llmBaseUrl,
});

const _originalAgentCreate = llmAgent.chat.completions.create.bind(llmAgent.chat.completions);
(llmAgent.chat.completions as any).create = (params: any, options?: any) =>
  _originalAgentCreate(
    {
      ...params,
      // Forwarded as request body — non-OpenAI providers ignore unknown fields.
      venice_parameters: { enable_web_search: "auto", ...(params?.venice_parameters ?? {}) },
    },
    options,
  );

export async function chat(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const r = await llm.chat.completions.create({
    model: config.llmModel,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 800,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return r.choices[0]?.message?.content?.trim() ?? "";
}
