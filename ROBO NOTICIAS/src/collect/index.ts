import type { Source } from "../config.js";
import { normalizeUrl } from "../url.js";
import { parseListing } from "./listing.js";
import { parseFeed } from "./rss.js";
import { parseSitemap } from "./sitemap.js";
import { titleKey } from "./text.js";
import type { RawItem } from "./types.js";
import { isTrailerVideo } from "./youtube.js";

export type { RawItem } from "./types.js";
export { parseFeed } from "./rss.js";
export { parseSitemap } from "./sitemap.js";
export { parseListing } from "./listing.js";
export { extractText } from "./extract.js";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export type CollectResult = { items: RawItem[]; failures: { sourceId: string; error: string }[] };
export type CollectOptions = { timeoutMs?: number; concurrency?: number };

export const USER_AGENT = "TralkedBot/1.0 (+https://tralked.com)";
export const ACCEPT = "text/html,application/xml;q=0.9,*/*;q=0.5";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CONCURRENCY = 6;
/** Sitemap index recursion limit: the root is depth 0, so at most depth 3 is fetched. */
export const MAX_SITEMAP_DEPTH = 3;
/** At most this many Google News links are resolved per feed (newest first). */
const MAX_GNEWS_RESOLVE = 40;
/** Give up resolving a Google News feed when this many first attempts all fail. */
const GNEWS_GIVE_UP_AFTER = 3;

// ---------- HTTP ----------

/** GET with the honest User-Agent, a hard timeout (also enforced when `fetchFn` ignores the abort signal) and no retries. */
export async function fetchPage(
  url: string,
  fetchFn: FetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ text: string; finalUrl: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timeout after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetchFn(url, {
        headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
        redirect: "follow",
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await Promise.race([res.text(), timeout]);
    return { text, finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function pool<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ---------- Google News link resolution ----------

const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/i;

/** Legacy Google News ids embed the publisher URL in base64. Newer ids do not, and then this finds nothing. */
function decodeLegacyId(link: string): string | null {
  try {
    const id = new URL(link).pathname.split("/").filter(Boolean).pop();
    if (!id) return null;
    const bytes = Buffer.from(id, "base64url").toString("latin1");
    const m = /https?:\/\/[\x21-\x7e]+/.exec(bytes);
    if (!m) return null;
    const url = m[0];
    return URL.canParse(url) && !GOOGLE_HOST.test(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Tries to find the publisher URL behind a Google News link using plain requests only (honest UA, normal
 * redirects). Returns null when it cannot; it never tries to get past a consent page or a challenge.
 */
async function resolveGoogleLink(link: string, fetchFn: FetchFn, timeoutMs: number): Promise<string | null> {
  const legacy = decodeLegacyId(link);
  if (legacy) return legacy;
  try {
    const { text, finalUrl } = await fetchPage(link, fetchFn, timeoutMs);
    if (URL.canParse(finalUrl) && !GOOGLE_HOST.test(new URL(finalUrl).hostname)) return finalUrl;
    const m = /data-n-au="(https?:\/\/[^"]+)"/.exec(text);
    if (m?.[1] && URL.canParse(m[1]) && !GOOGLE_HOST.test(new URL(m[1]).hostname)) return m[1];
    return null;
  } catch {
    return null;
  }
}

async function resolveGoogleNews(items: RawItem[], fetchFn: FetchFn, timeoutMs: number): Promise<RawItem[]> {
  const sorted = [...items].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  let attempts = 0;
  let resolvedAny = false;
  const out: RawItem[] = [];
  for (const [i, item] of sorted.entries()) {
    const giveUp = !resolvedAny && attempts >= GNEWS_GIVE_UP_AFTER;
    const publisherUrl =
      i < MAX_GNEWS_RESOLVE && !giveUp ? (attempts++, await resolveGoogleLink(item.url, fetchFn, timeoutMs)) : null;
    if (publisherUrl) {
      resolvedAny = true;
      out.push({ ...item, url: publisherUrl });
    } else {
      out.push({ ...item, textUnavailable: true });
    }
  }
  return out;
}

// ---------- per-source collection ----------

/** Replaces a `/20xx/` path segment with the current year (CD PROJEKT hard-codes it); falls back to the previous year. */
function yearUrls(url: string, now: Date): string[] {
  if (!URL.canParse(url)) return [url];
  const u = new URL(url);
  const segs = u.pathname.split("/");
  const idx = segs.findIndex((s) => /^20\d{2}$/.test(s));
  if (idx < 0) return [url];
  const withYear = (y: number) => {
    const copy = new URL(url);
    const s = copy.pathname.split("/");
    s[idx] = String(y);
    copy.pathname = s.join("/");
    return copy.toString();
  };
  const year = now.getUTCFullYear();
  return [withYear(year), withYear(year - 1)];
}

async function collectSource(source: Source, fetchFn: FetchFn, now: Date, timeoutMs: number): Promise<RawItem[]> {
  if (source.kind === "rss") {
    const { text } = await fetchPage(source.url, fetchFn, timeoutMs);
    const items = parseFeed(text, source.id);
    // Signal-only sources (Reddit hot lists) are titles that say what players talk about, never text.
    if (source.signalOnly) return items.map((item) => ({ ...item, textUnavailable: true as const }));
    // Official channels: new trailers and gameplay only. A watch page has no article text to extract; the
    // title and the description (summary) are the material, and the video is embedded in the article.
    if (source.video) {
      return items
        .filter((item) => item.videoId !== undefined && isTrailerVideo(item.title, item.url))
        .map((item) => ({ ...item, textUnavailable: true as const }));
    }
    return source.linkResolve === "google-news" ? resolveGoogleNews(items, fetchFn, timeoutMs) : items;
  }

  if (!source.listingSelector) throw new Error("listing source has no listingSelector");
  let lastError: unknown;
  for (const url of yearUrls(source.url, now)) {
    try {
      const { text } = await fetchPage(url, fetchFn, timeoutMs);
      return parseListing(text, url, source.listingSelector, source.id);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** Drops repeated URLs (first wins) and unresolved Google News items whose title another source already has. */
function dedupe(items: RawItem[]): RawItem[] {
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const key = normalizeUrl(i.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const titles = new Set(unique.filter((i) => !i.textUnavailable).map((i) => titleKey(i.title)));
  return unique.filter((i) => !i.textUnavailable || !titles.has(titleKey(i.title)));
}

/**
 * Collects the active sources (RSS/Atom feeds and HTML listings). A failing source never throws: it is
 * reported in `failures` and the other sources still return their items.
 *
 * Google News sources (`linkResolve`): the publisher URL is resolved with plain redirected requests. When
 * that does not work the item is kept with the Google link as `url`, `textUnavailable: true`, the
 * `publisher` and the snippet, so dedup by link still works.
 */
export async function collectLive(
  sources: Source[],
  fetchFn: FetchFn = fetch,
  now: Date = new Date(),
  opts: CollectOptions = {},
): Promise<CollectResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const active = sources.filter((s) => s.active);
  const results = await pool(
    active.map((source) => async (): Promise<{ source: Source; items: RawItem[] } | { source: Source; error: string }> => {
      try {
        return { source, items: await collectSource(source, fetchFn, now, timeoutMs) };
      } catch (e) {
        return { source, error: errorMessage(e) };
      }
    }),
    opts.concurrency ?? DEFAULT_CONCURRENCY,
  );

  const items: RawItem[] = [];
  const failures: CollectResult["failures"] = [];
  for (const r of results) {
    if ("error" in r) failures.push({ sourceId: r.source.id, error: r.error });
    else items.push(...r.items);
  }
  return { items: dedupe(items), failures };
}

/**
 * Collects the backfill sitemaps of the given sources for `[from, to]`. Sitemap indexes are followed up to
 * depth 3 (cycles are ignored). Never throws: failures are reported per source, and a failing child
 * does not stop its siblings.
 */
export async function collectBackfill(
  sources: Source[],
  from: Date,
  to: Date,
  fetchFn: FetchFn = fetch,
  opts: CollectOptions = {},
): Promise<CollectResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const withBackfill = sources.filter((s) => s.active && s.backfill);

  const results = await pool(
    withBackfill.map((source) => async () => {
      const items: RawItem[] = [];
      const failures: CollectResult["failures"] = [];
      const visited = new Set<string>();

      const walk = async (url: string, depth: number): Promise<void> => {
        if (visited.has(url)) return;
        visited.add(url);
        const { text } = await fetchPage(url, fetchFn, timeoutMs);
        const parsed = parseSitemap(text, source.id, from, to);
        items.push(...parsed.items);
        if (parsed.children.length && depth >= MAX_SITEMAP_DEPTH) {
          failures.push({ sourceId: source.id, error: `${url}: sitemap depth limit (${MAX_SITEMAP_DEPTH}) reached` });
          return;
        }
        for (const child of parsed.children) {
          try {
            await walk(child, depth + 1);
          } catch (e) {
            failures.push({ sourceId: source.id, error: `${child}: ${errorMessage(e)}` });
          }
        }
      };

      try {
        await walk(source.backfill!.url, 0);
      } catch (e) {
        failures.push({ sourceId: source.id, error: `${source.backfill!.url}: ${errorMessage(e)}` });
      }
      return { items, failures };
    }),
    opts.concurrency ?? DEFAULT_CONCURRENCY,
  );

  const seen = new Set<string>();
  const items: RawItem[] = [];
  const failures: CollectResult["failures"] = [];
  for (const r of results) {
    failures.push(...r.failures);
    for (const item of r.items) {
      const key = normalizeUrl(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return { items, failures };
}
