import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { log } from "../../util/log.js";

export type ScrapeResult = {
  url: string;
  title: string;
  text: string;
  byline?: string;
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_CHARS = 6000;

export async function scrapePage(url: string, timeoutMs = 12_000): Promise<ScrapeResult> {
  log.debug({ url }, "scrape.start");
  const res = await axios.get<string>(url, {
    timeout: timeoutMs,
    responseType: "text",
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      "User-Agent": UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  const html = res.data;

  // Try Readability first — much higher quality main-text extraction.
  let title = "";
  let text = "";
  let byline: string | undefined;

  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (article && article.textContent) {
      title = (article.title ?? "").trim();
      text = article.textContent.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (article.byline) byline = article.byline;
    }
  } catch (err) {
    log.debug({ err: String(err) }, "scrape.readability_failed");
  }

  // Fallback: cheerio-based stripped text from <article> or <main> or <body>.
  if (!text) {
    const $ = cheerio.load(html);
    title = title || $("title").first().text().trim() || $("h1").first().text().trim();
    $("script, style, noscript, header, footer, nav, aside, form, iframe").remove();
    const root = $("article").first().length
      ? $("article").first()
      : $("main").first().length
        ? $("main").first()
        : $("body");
    text = root.text().replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "…";

  log.debug({ url, chars: text.length }, "scrape.done");
  return { url, title, text, byline };
}
