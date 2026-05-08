import { config } from "../../config.js";
import { log } from "../../util/log.js";
import type { DigestStory } from "../../store/types.js";
import { nowIso } from "../../util/time.js";
import { recordDigest } from "./history.js";
import { searchNews } from "./searchNews.js";
import { scrapePage } from "./scrapePage.js";
import { summarizeText } from "./summarize.js";
import { getOrCreateGroup } from "./settings.js";

function buildQuery(topics: string[]): string {
  if (!topics.length) return "latest AI artificial intelligence news";
  const t = topics.map((x) => `"${x}"`).join(" OR ");
  return `(${t}) AI news`;
}

export type DigestRunResult = {
  text: string;
  stories: DigestStory[];
};

export async function runDigest(groupJid: string): Promise<DigestRunResult> {
  const g = await getOrCreateGroup(groupJid);
  const query = buildQuery(g.topics);

  log.info({ groupJid, query }, "digest.start");
  const results = await searchNews(query, config.digestResults);
  log.info({ groupJid, found: results.length }, "digest.search_done");

  const stories: DigestStory[] = [];

  // Scrape + summarize concurrently but isolate failures.
  const work = results.map(async (r) => {
    try {
      const page = await scrapePage(r.url);
      if (!page.text || page.text.length < 200) {
        // Not enough content — fall back to snippet-only summary if available.
        if (r.snippet) {
          return { title: r.title, url: r.url, summary: `• ${r.snippet}` };
        }
        return null;
      }
      const summary = await summarizeText(page.title || r.title, page.text);
      return { title: page.title || r.title, url: r.url, summary };
    } catch (err) {
      log.warn({ url: r.url, err: String(err) }, "digest.story_failed");
      return null;
    }
  });

  const settled = await Promise.all(work);
  for (const s of settled) if (s) stories.push(s);

  if (stories.length === 0) {
    return {
      text: "I couldn't pull a digest right now — the search and scrape steps both came back empty. Try /news again in a few minutes.",
      stories: [],
    };
  }

  const headerTopics = g.topics.length ? ` (${g.topics.join(", ")})` : "";
  const header = `🧠 *AI News Digest*${headerTopics}`;

  const blocks = stories.map((s, i) => {
    const cleanSummary = s.summary.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
    return `*${i + 1}. ${s.title}*\n${cleanSummary}\n${s.url}`;
  });

  const text = [header, ...blocks].join("\n\n");

  await recordDigest({ groupJid, sentAt: nowIso(), stories });
  log.info({ groupJid, stories: stories.length }, "digest.done");

  return { text, stories };
}
