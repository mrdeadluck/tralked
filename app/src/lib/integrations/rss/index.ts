import { timeoutSignal } from "../http";

/**
 * Minimal RSS 2.0 / Atom reader for external news. Only what Tralked stores is extracted:
 * title (plain text), link (http/https only) and date. Item bodies are never read, so no
 * third-party text or HTML is copied.
 */

export type FeedItem = { title: string; url: string; publishedAt: Date };

const MAX_FEED_BYTES = 2_000_000;
const MAX_ITEMS = 100;
const MAX_TITLE_LENGTH = 300;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Text content of an element: CDATA unwrapped, tags removed, entities decoded, spaces collapsed. */
function plainText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Decode first so escaped markup (`&lt;b&gt;`) is stripped too.
  return decodeEntities(unwrapped)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function element(block: string, names: string[]): string | null {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
    if (match) return match[1];
  }
  return null;
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(decodeEntities(value.trim()));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function linkOf(block: string): string | null {
  // Atom: <link href="..." rel="alternate"/> (rel defaults to alternate).
  for (const match of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = match[1];
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "alternate";
    if (href && rel === "alternate") return safeUrl(href);
  }
  const rssLink = element(block, ["link"]);
  const fromLink = rssLink ? safeUrl(plainText(rssLink)) : null;
  if (fromLink) return fromLink;
  const guid = element(block, ["guid"]);
  return guid ? safeUrl(plainText(guid)) : null;
}

/** Items of an RSS 2.0 or Atom document, skipping any without a title, a safe link or a date. */
export function parseFeed(xml: string, now: Date = new Date()): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const items: FeedItem[] = [];
  for (const block of blocks.slice(0, MAX_ITEMS)) {
    const rawTitle = element(block, ["title"]);
    const title = rawTitle ? plainText(rawTitle).slice(0, MAX_TITLE_LENGTH) : "";
    const url = linkOf(block);
    const rawDate = element(block, ["pubDate", "published", "updated", "dc:date"]);
    const date = rawDate ? new Date(plainText(rawDate)) : null;
    if (!title || !url || !date || Number.isNaN(date.getTime())) continue;
    // A date in the future would pin the item to the top of every list.
    items.push({ title, url, publishedAt: date > now ? now : date });
  }
  return items;
}

/** Downloads and parses one feed. Throws on HTTP errors and on oversized documents. */
export async function fetchFeed(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<FeedItem[]> {
  const res = await fetchImpl(url, {
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: timeoutSignal(),
  });
  if (!res.ok) throw new Error(`Feed request failed with HTTP ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FEED_BYTES) throw new Error("Feed is too large");
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error("Feed is too large");
  return parseFeed(text);
}
