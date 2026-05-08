import { chat } from "../groqClient.js";
import { scrapePage } from "./scrapePage.js";

const ARTICLE_SYS = `You are a precise news summarizer for a WhatsApp tech audience.
Output ONLY the summary, no preamble, no headings.
Format: 3 short bullets, each <= 22 words, starting with "•".
Bullets must capture: (1) what happened, (2) why it matters / who it affects, (3) one concrete number, name, or date if present in the article.
Do not invent facts. If the article is too short to summarize, say "• Insufficient article content." once.`;

export async function summarizeText(title: string, text: string): Promise<string> {
  const trimmed = text.slice(0, 5500);
  const prompt = `Title: ${title}\n\nArticle:\n${trimmed}`;
  return chat(ARTICLE_SYS, prompt, { temperature: 0.2, maxTokens: 220 });
}

export async function summarizeUrl(url: string): Promise<{ title: string; url: string; summary: string }> {
  const page = await scrapePage(url);
  const summary = await summarizeText(page.title || url, page.text);
  return { title: page.title || url, url, summary };
}
