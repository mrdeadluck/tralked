import { XMLParser } from "fast-xml-parser";
import { decodeEntities, isHttpUrl, makeSummary, parseDate, titleKey } from "./text.js";
import type { RawItem } from "./types.js";
import { isValidYoutubeId, youtubeIdOf } from "./youtube.js";

export type { RawItem } from "./types.js";

const ARRAY_TAGS = new Set(["item", "entry", "link"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

type Node = Record<string, unknown>;

/** First string value of an XML node (plain text, `#text`, or the first element of an array). */
export function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length ? str(v[0]) : null;
  if (typeof v === "object") return str((v as Node)["#text"]);
  return null;
}

function arr(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function pickLink(links: unknown): string | null {
  const candidates: { href: string; rel: string | null }[] = [];
  for (const l of arr(links)) {
    if (typeof l === "string") {
      candidates.push({ href: l.trim(), rel: null });
    } else if (l && typeof l === "object") {
      const o = l as Node;
      const href = str(o["@_href"]) ?? str(o["#text"]);
      if (href) candidates.push({ href: href.trim(), rel: str(o["@_rel"]) });
    }
  }
  const best =
    candidates.find((c) => c.rel === "alternate") ??
    candidates.find((c) => c.rel === null || c.rel === "") ??
    candidates[0];
  return best && isHttpUrl(best.href) ? best.href : null;
}

function pickSummary(item: Node): string | null {
  const group = item["media:group"] as Node | undefined;
  const candidates = [
    item["description"],
    item["summary"],
    group?.["media:description"],
    item["media:description"],
    item["content:encoded"],
    item["content"],
  ];
  for (const c of candidates) {
    const s = makeSummary(str(c));
    if (s) return s;
  }
  return null;
}

function toItem(raw: Node, sourceId: string): RawItem | null {
  const url = pickLink(raw["link"]) ?? (isHttpUrl(str(raw["guid"]) ?? "") ? (str(raw["guid"]) as string) : null);
  if (!url) return null;

  let title = decodeEntities(str(raw["title"]) ?? "");
  const publisher = decodeEntities(str(raw["source"]) ?? "") || undefined;
  if (publisher && title.toLowerCase().endsWith(` - ${publisher.toLowerCase()}`)) {
    title = title.slice(0, title.length - publisher.length - 3).trimEnd();
  }
  if (!title) return null;

  let summary = pickSummary(raw);
  // Google News snippets just repeat "<title> <publisher>": not useful material.
  if (summary && publisher) {
    const key = titleKey(summary);
    if (key === titleKey(title) || key === titleKey(title) + titleKey(publisher)) summary = null;
  }

  const publishedAt =
    parseDate(str(raw["pubDate"])) ??
    parseDate(str(raw["published"])) ??
    parseDate(str(raw["dc:date"])) ??
    parseDate(str(raw["updated"])) ??
    parseDate(str(raw["issued"]));

  const item: RawItem = { url, title, summary, publishedAt, sourceId };
  if (publisher) item.publisher = publisher;
  // YouTube channel feeds (Atom) carry the id as <yt:videoId>; the watch link has it too.
  const videoId = str(raw["yt:videoId"])?.trim() ?? youtubeIdOf(url);
  if (isValidYoutubeId(videoId)) item.videoId = videoId;
  return item;
}

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom. Throws when `xml` is not a feed (e.g. an HTML challenge page). */
export function parseFeed(xml: string, sourceId: string): RawItem[] {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (e) {
    throw new Error(`not a feed: ${(e as Error).message}`);
  }
  const rss = doc["rss"] as Node | undefined;
  const atom = doc["feed"] as Node | undefined;
  const rdf = doc["rdf:RDF"] as Node | undefined;

  let rawItems: unknown[];
  if (rss && typeof rss === "object") {
    rawItems = arr((rss["channel"] as Node | undefined)?.["item"]);
  } else if (atom && typeof atom === "object") {
    rawItems = arr(atom["entry"]);
  } else if (rdf && typeof rdf === "object") {
    rawItems = arr(rdf["item"]);
  } else {
    throw new Error("not a feed: no <rss>, <feed> or <rdf:RDF> root element");
  }

  const items: RawItem[] = [];
  for (const r of rawItems) {
    if (!r || typeof r !== "object") continue;
    const item = toItem(r as Node, sourceId);
    if (item) items.push(item);
  }
  return items;
}
