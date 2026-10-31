import { timeoutSignal } from "../http";

/**
 * Minimal RSS 2.0 / Atom reader for external news. Only what Tralked stores is extracted:
 * title (plain text), link (http/https only) and date. Item bodies are never read, so no
 * third-party text or HTML is copied.
 *
 * Feeds are untrusted input: the download is capped while streaming, and parsing is a forward
 * scan with `indexOf` (no backtracking regex over the document), so a malformed feed (unclosed
 * tags, huge bodies) costs linear time.
 */

export type FeedItem = { title: string; url: string; publishedAt: Date };

export const MAX_FEED_BYTES = 2_000_000;
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
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,8});/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** CDATA sections unwrapped, by forward scan (an unclosed section runs to the end). */
function unwrapCdata(raw: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const start = raw.indexOf("<![CDATA[", pos);
    if (start < 0) return out + raw.slice(pos);
    const end = raw.indexOf("]]>", start + 9);
    out += raw.slice(pos, start) + raw.slice(start + 9, end < 0 ? raw.length : end);
    if (end < 0) return out;
    pos = end + 3;
  }
}

/** Text content of an element: CDATA unwrapped, tags removed, entities decoded, spaces collapsed. */
function plainText(raw: string): string {
  // Decode first so escaped markup (`&lt;b&gt;`) is stripped too. `[^<>]` keeps the tag
  // pattern linear: it never scans past the next "<".
  return decodeEntities(unwrapCdata(raw))
    .replace(/<[^<>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Start of the next `<name` tag (followed by whitespace, `>` or `/`) at or after `from`, in `lower`. */
function findTag(lower: string, name: string, from: number): number {
  let pos = from;
  for (;;) {
    const at = lower.indexOf(`<${name}`, pos);
    if (at < 0) return -1;
    const next = lower[at + name.length + 1];
    if (next === undefined || next === ">" || next === "/" || /\s/.test(next)) return at;
    pos = at + 1;
  }
}

/** Inner text of the first `<name ...>...</name>` in `block` (lowercased copy: `lower`). */
function element(block: string, lower: string, names: string[]): string | null {
  for (const name of names) {
    const open = findTag(lower, name, 0);
    if (open < 0) continue;
    const gt = lower.indexOf(">", open);
    if (gt < 0) continue;
    if (lower[gt - 1] === "/") continue; // self-closing: no content
    const close = lower.indexOf(`</${name}>`, gt + 1);
    if (close < 0) continue;
    return block.slice(gt + 1, close);
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

const attribute = (attrs: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];

function linkOf(block: string, lower: string): string | null {
  // Atom: <link href="..." rel="alternate"/> (rel defaults to alternate).
  for (let pos = findTag(lower, "link", 0); pos >= 0; pos = findTag(lower, "link", pos + 1)) {
    const gt = lower.indexOf(">", pos);
    if (gt < 0) break;
    const attrs = block.slice(pos + 5, gt);
    const href = attribute(attrs, "href");
    const rel = attribute(attrs, "rel") ?? "alternate";
    if (href && rel === "alternate") return safeUrl(href);
  }
  const rssLink = element(block, lower, ["link"]);
  const fromLink = rssLink ? safeUrl(plainText(rssLink)) : null;
  if (fromLink) return fromLink;
  const guid = element(block, lower, ["guid"]);
  return guid ? safeUrl(plainText(guid)) : null;
}

/** Items of an RSS 2.0 or Atom document, skipping any without a title, a safe link or a date. */
export function parseFeed(xml: string, now: Date = new Date()): FeedItem[] {
  // ASCII-only lowercasing keeps every index aligned with `xml` (toLowerCase can change lengths).
  const lower = xml.replace(/[A-Z]+/g, (s) => s.toLowerCase());
  const items: FeedItem[] = [];
  let pos = 0;
  // Next position of each tag (-1: none left). Searched again only once the scan has passed it,
  // so each search walks the document about once.
  let item = findTag(lower, "item", 0);
  let entry = findTag(lower, "entry", 0);
  for (let scanned = 0; scanned < MAX_ITEMS; scanned++) {
    if (item >= 0 && item < pos) item = findTag(lower, "item", pos);
    if (entry >= 0 && entry < pos) entry = findTag(lower, "entry", pos);
    const start = item < 0 ? entry : entry < 0 ? item : Math.min(item, entry);
    if (start < 0) break;
    const name = start === item ? "item" : "entry";
    const bodyStart = lower.indexOf(">", start);
    const end = bodyStart < 0 ? -1 : lower.indexOf(`</${name}>`, bodyStart);
    // An unclosed item ends the document: nothing after it can be trusted.
    if (end < 0) break;
    pos = end + name.length + 3;

    const block = xml.slice(bodyStart + 1, end);
    const blockLower = lower.slice(bodyStart + 1, end);    const rawTitle = element(block, blockLower, ["title"]);
    const title = rawTitle ? plainText(rawTitle).slice(0, MAX_TITLE_LENGTH) : "";
    const url = linkOf(block, blockLower);
    const rawDate = element(block, blockLower, ["pubdate", "published", "updated", "dc:date"]);
    const date = rawDate ? new Date(plainText(rawDate)) : null;
    if (!title || !url || !date || Number.isNaN(date.getTime())) continue;
    // A date in the future would pin the item to the top of every list.
    items.push({ title, url, publishedAt: date > now ? now : date });
  }
  return items;
}

/** Reads a response body as text, failing as soon as it grows past `maxBytes` (chunked bodies too). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Feed is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
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
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`Feed request failed with HTTP ${res.status}`);
  }
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FEED_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new Error("Feed is too large");
  }
  return parseFeed(await readCapped(res, MAX_FEED_BYTES));
}
