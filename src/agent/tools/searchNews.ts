import { getJson } from "serpapi";
import { config } from "../../config.js";
import { log } from "../../util/log.js";

export type SearchResult = {
  title: string;
  url: string;
  source?: string;
  snippet?: string;
};

const TRACKERS = /[?&](utm_[^=]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src)=[^&]+/g;

function cleanUrl(u: string): string {
  try {
    const url = new URL(u);
    url.search = url.search.replace(TRACKERS, "").replace(/^\?&/, "?");
    if (url.search === "?") url.search = "";
    return url.toString();
  } catch {
    return u;
  }
}

export async function searchNews(query: string, num = config.digestResults): Promise<SearchResult[]> {
  log.debug({ query, num }, "serpapi.search");

  const params: Record<string, string | number> = {
    engine: "google",
    q: query,
    api_key: config.serpApiKey,
    num: Math.min(20, num * 3),
    hl: "en",
    tbm: "nws",
    tbs: "qdr:d",
  };

  const data = await getJson(params);

  const news: SearchResult[] = (data.news_results ?? []).map((r: any) => ({
    title: String(r.title ?? "").trim(),
    url: cleanUrl(String(r.link ?? "")),
    source: r.source ? String(r.source) : undefined,
    snippet: r.snippet ? String(r.snippet) : undefined,
  }));

  // Fallback: if news engine returned nothing, try organic results.
  let pool: SearchResult[] = news;
  if (pool.length === 0 && Array.isArray(data.organic_results)) {
    pool = (data.organic_results as any[]).map((r) => ({
      title: String(r.title ?? "").trim(),
      url: cleanUrl(String(r.link ?? "")),
      source: r.displayed_link ? String(r.displayed_link) : undefined,
      snippet: r.snippet ? String(r.snippet) : undefined,
    }));
  }

  // Drop entries without a title or url.
  pool = pool.filter((r) => r.title && r.url && /^https?:\/\//.test(r.url));

  // Dedupe by domain — diversify sources.
  const seenDomain = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of pool) {
    let host = "";
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (seenDomain.has(host)) continue;
    seenDomain.add(host);
    out.push(r);
    if (out.length >= num) break;
  }

  log.debug({ kept: out.length }, "serpapi.search.done");
  return out;
}
