import { XMLParser } from "fast-xml-parser";
import { decodeEntities, isHttpUrl, parseDate, titleFromUrl } from "./text.js";
import type { RawItem } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "url" || name === "sitemap",
});

type Node = Record<string, unknown>;

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && !Array.isArray(v)) return str((v as Node)["#text"]);
  return null;
}

function arr(v: unknown): Node[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is Node => !!x && typeof x === "object");
}

/**
 * Parses a sitemap file.
 *
 * - `<sitemapindex>`: returns the child sitemap URLs in `children`. A child is dropped when its `lastmod`
 *   is before `from` (nothing in it can be newer than that); children without `lastmod` are kept.
 *   `lastmod` is not compared with `to`: a monthly file for the window is usually modified after it.
 * - `<urlset>`: returns the entries whose date (`news:publication_date`, else `lastmod`) is inside
 *   `[from, to]`. Entries with no date are dropped because they cannot be placed in the window.
 *   The title is `news:title`, else derived from the last URL segment.
 *
 * Throws when `xml` is not a sitemap.
 */
export function parseSitemap(
  xml: string,
  sourceId: string,
  from: Date,
  to: Date,
): { items: RawItem[]; children: string[] } {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (e) {
    throw new Error(`not a sitemap: ${(e as Error).message}`);
  }

  const index = doc["sitemapindex"] as Node | undefined;
  if (index && typeof index === "object") {
    const children: string[] = [];
    for (const s of arr(index["sitemap"])) {
      const loc = str(s["loc"])?.trim();
      if (!loc || !isHttpUrl(loc)) continue;
      const lastmod = parseDate(str(s["lastmod"]));
      if (lastmod && lastmod < from) continue;
      children.push(loc);
    }
    return { items: [], children };
  }

  const urlset = doc["urlset"] as Node | undefined;
  if (urlset && typeof urlset === "object") {
    const items: RawItem[] = [];
    for (const u of arr(urlset["url"])) {
      const loc = str(u["loc"])?.trim();
      if (!loc || !isHttpUrl(loc)) continue;
      const news = arr(u["news:news"])[0];
      const date = parseDate(str(news?.["news:publication_date"])) ?? parseDate(str(u["lastmod"]));
      if (!date || date < from || date > to) continue;
      const newsTitle = decodeEntities(str(news?.["news:title"]) ?? "");
      items.push({
        url: loc,
        title: newsTitle || titleFromUrl(loc),
        summary: null,
        publishedAt: date,
        sourceId,
      });
    }
    return { items, children: [] };
  }

  throw new Error("not a sitemap: no <urlset> or <sitemapindex> root element");
}
