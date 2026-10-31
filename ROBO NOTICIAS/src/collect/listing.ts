import { parseHTML } from "linkedom";
import { normalizeUrl } from "../url.js";
import { titleFromUrl } from "./text.js";
import type { RawItem } from "./types.js";

/** Path segments that mark section, taxonomy, pagination or utility pages rather than articles. */
const SECTION_SEGMENTS = new Set([
  "category", "categories", "tag", "tags", "topic", "topics", "section", "sections",
  "author", "authors", "page", "search", "archive", "archives", "feed", "rss",
  "login", "signin", "signup", "register", "subscribe", "newsletter", "contact", "about",
]);

const hostKey = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, "");
const segmentsOf = (u: URL) => u.pathname.split("/").filter(Boolean);

/**
 * Article-like means: http(s), same host as the listing page (ignoring `www.`), a path deeper than one
 * segment, not the listing page itself (or one of its parents), and no section/taxonomy/pagination segment.
 */
export function isArticleLike(link: URL, page: URL): boolean {
  if (link.protocol !== "http:" && link.protocol !== "https:") return false;
  if (hostKey(link) !== hostKey(page)) return false;
  const segs = segmentsOf(link);
  if (segs.length < 2) return false;
  const pageSegs = segmentsOf(page);
  const isPageOrParent = segs.length <= pageSegs.length && segs.every((s, i) => s === pageSegs[i]);
  if (isPageOrParent) return false;
  return !segs.some((s) => SECTION_SEGMENTS.has(s.toLowerCase()));
}

function cleanText(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Extracts article links from a listing page. `selector` picks the anchors (it may also match section
 * links, which are filtered out), URLs are made absolute against `baseUrl` and de-duplicated.
 */
export function parseListing(html: string, baseUrl: string, selector: string, sourceId: string): RawItem[] {
  const base = new URL(baseUrl);
  const { document } = parseHTML(html);
  const found = new Map<string, { item: RawItem; fallbackTitle: boolean }>();

  for (const el of Array.from(document.querySelectorAll(selector))) {
    const anchor = el.tagName.toLowerCase() === "a" ? el : (el.closest("a") ?? el.querySelector("a"));
    const href = anchor?.getAttribute("href")?.trim();
    if (!anchor || !href) continue;

    let link: URL;
    try {
      link = new URL(href, base);
    } catch {
      continue;
    }
    link.hash = "";
    if (!isArticleLike(link, base)) continue;

    const text = cleanText(el.textContent);
    const alt = cleanText(anchor.querySelector("img")?.getAttribute("alt"));
    const title = text || cleanText(anchor.getAttribute("title")) || cleanText(anchor.getAttribute("aria-label")) || alt;
    const url = link.toString();
    const key = normalizeUrl(url);
    const existing = found.get(key);
    if (existing && !(existing.fallbackTitle && title)) continue;

    found.set(key, {
      item: { url: existing?.item.url ?? url, title: title || titleFromUrl(url), summary: null, publishedAt: null, sourceId },
      fallbackTitle: !title,
    });
  }
  return Array.from(found.values(), (v) => v.item);
}
