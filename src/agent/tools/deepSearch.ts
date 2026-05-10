import { getJson } from "serpapi";
import { config } from "../../config.js";
import { log } from "../../util/log.js";

export type DeepSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
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

/**
 * Broad-spectrum Google search via SerpAPI, used when Venice's built-in web
 * search isn't enough — niche topics, older information, or when the user
 * explicitly asks for a deeper / more thorough search.
 *
 * Differs from `searchNews()`:
 *   - no `tbm=nws`        (organic results, not just news)
 *   - no `tbs=qdr:d`      (no past-24h restriction)
 *   - returns more results so the model has a wider pool to reason over
 */
export async function deepSearch(query: string, num = 10): Promise<DeepSearchResult[]> {
  log.debug({ query, num }, "serpapi.deep_search");

  const params: Record<string, string | number> = {
    engine: "google",
    q: query,
    api_key: config.serpApiKey,
    num: Math.min(20, Math.max(num * 2, 10)),
    hl: "en",
  };

  const data = await getJson(params);

  const organic: DeepSearchResult[] = (data.organic_results ?? []).map((r: any) => ({
    title: String(r.title ?? "").trim(),
    url: cleanUrl(String(r.link ?? "")),
    snippet: r.snippet ? String(r.snippet) : undefined,
    source: r.displayed_link ? String(r.displayed_link) : undefined,
  }));

  // Drop entries without a title or url, dedupe by domain to diversify sources.
  const seenDomain = new Set<string>();
  const out: DeepSearchResult[] = [];
  for (const r of organic) {
    if (!r.title || !r.url || !/^https?:\/\//.test(r.url)) continue;
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

  log.debug({ kept: out.length }, "serpapi.deep_search.done");
  return out;
}
