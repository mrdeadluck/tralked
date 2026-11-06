import type { FetchFn } from "../collect/index.js";
import { mediaOf } from "../collect/media.js";
import { isValidYoutubeId } from "../collect/youtube.js";
import type { Source } from "../config.js";
import type { ItemRow, StoryRow } from "../db.js";
import { gameNameKey } from "../tralked.js";

/** YouTube videos looked up per story at most (oEmbed, no key, no AI). */
const MAX_LOOKUPS = 5;
const TIMEOUT_MS = 10_000;
/**
 * A video published longer than this before the story is not the story's video (story 4929: the source
 * cited the 2018 teaser of the series; the news was the 2026 name reveal). Two weeks keeps a trailer a
 * site writes about some days later.
 */
export const VIDEO_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** A video title that presents something (used when the story names no game). */
const VIDEO_WORDS = /\b(trailers?|gameplay|teasers?|reveal|revela[cç][aã]o|announce(ment)?|an[uú]ncio)\b/i;
/** A headline or item title about a video. */
const ABOUT_VIDEO = /\b(trailers?|gameplay|teasers?|v[ií]deos?|reveal)\b/i;

/** A channel name as compared: "Bethesda Softworks (YouTube channel)" → "bethesda softworks". */
const channelKey = (name: string) => gameNameKey(name.replace(/\s*\((?:YouTube|canal)[^)]*\)\s*$/i, ""));

/** The story's games as title fragments: the full name and the name without subtitle. */
function gameKeys(games: string[]): string[] {
  const out = new Set<string>();
  for (const g of games) {
    out.add(gameNameKey(g));
    // "The Elder Scrolls VI: Sentinel" is also "The Elder Scrolls VI"; "Call of Duty: Black Ops 7" is not "Call of Duty".
    const colon = g.indexOf(":");
    const base = colon > 0 ? gameNameKey(g.slice(0, colon)) : "";
    if (/\d$/.test(base)) out.add(base);
  }
  out.delete("");
  return [...out];
}

const has = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

async function oembed(id: string, fetchFn: FetchFn): Promise<{ title: string; author_name: string } | null> {
  const watch = `https://www.youtube.com/watch?v=${id}`;
  try {
    const res = await fetchFn(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { title?: unknown; author_name?: unknown };
    return typeof body.title === "string" && typeof body.author_name === "string" ? { title: body.title, author_name: body.author_name } : null;
  } catch {
    return null;
  }
}

/** The watch page's publication date: `itemprop="datePublished"`, else the player's `publishDate`. */
const DATE_PATTERNS = [
  /itemprop="datePublished"\s+content="([^"]+)"/,
  /"publishDate":"([^"]+)"/,
  /itemprop="uploadDate"\s+content="([^"]+)"/,
  /"uploadDate":"([^"]+)"/,
];

/**
 * When a YouTube video was published, read from its public watch page (oEmbed has no date, and the Data API
 * needs a key). Null when the page cannot be read or carries no date.
 */
export async function videoPublishedAt(id: string, fetchFn: FetchFn): Promise<Date | null> {
  if (!isValidYoutubeId(id)) return null;
  try {
    const res = await fetchFn(`https://www.youtube.com/watch?v=${id}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "accept-language": "en-US,en;q=0.9" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    for (const pattern of DATE_PATTERNS) {
      const at = Date.parse(pattern.exec(html)?.[1] ?? "");
      if (!Number.isNaN(at)) return new Date(at);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether the video is recent enough to be the story's video: published at most `VIDEO_MAX_AGE_MS` before
 * the story. A video whose date cannot be read is refused (an old video shown as the news is worse than
 * no video).
 */
export async function isRecentVideo(id: string, storyAt: Date, fetchFn: FetchFn): Promise<boolean> {
  const published = await videoPublishedAt(id, fetchFn);
  return published !== null && published.getTime() >= storyAt.getTime() - VIDEO_MAX_AGE_MS;
}

/**
 * The official video a source page embeds or links, when the story is about it (spec "Escolher o vídeo"):
 * - the channel is official: its name is exactly one of the robot's official channels (`video: true`
 *   sources) or one of the story's companies;
 * - the title is about the story: it names one of the story's games (without the subtitle only when the
 *   name ends in a number) or, when the story has no game, it is a trailer naming one of its companies.
 * A react or a news site's channel never passes. Title and channel come from YouTube's public oEmbed.
 * - it is recent: published at most `VIDEO_MAX_AGE_MS` before the story (`storyAt`, its earliest item).
 */
export async function officialSourceVideo(
  input: { items: ItemRow[]; sources: Source[]; games: string[]; companies: string[]; storyAt: Date },
  fetchFn: FetchFn,
): Promise<{ youtubeId: string; title: string; channel: string } | null> {
  const ids = [...new Set(input.items.flatMap((i) => mediaOf(i).youtube).filter(isValidYoutubeId))].slice(0, MAX_LOOKUPS);
  if (ids.length === 0) return null;
  const channels = new Set(input.sources.filter((s) => s.video).map((s) => channelKey(s.name)));
  const companies = input.companies.map(gameNameKey).filter((c) => c.length >= 2);
  const games = gameKeys(input.games);

  for (const id of ids) {
    const meta = await oembed(id, fetchFn);
    if (!meta) continue;
    const channel = channelKey(meta.author_name);
    // Exactly an official channel or a company of the story: "Nintendo Life" is not "Nintendo".
    const official = channels.has(channel) || companies.includes(channel);
    if (!official) continue;
    const title = gameNameKey(meta.title);
    const about =
      games.length > 0 ? games.some((g) => has(title, g)) : VIDEO_WORDS.test(meta.title) && companies.some((c) => has(title, c));
    if (!about) continue;
    if (!(await isRecentVideo(id, input.storyAt, fetchFn))) continue;
    return { youtubeId: id, title: meta.title, channel: meta.author_name };
  }
  return null;
}

/** An official channel's video counts as the story's when published this close to the story (either side). */
export const CHANNEL_VIDEO_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The story's video from an official channel the robot follows (spec "Escolher o vídeo"), when no item of
 * the story brings one: a video of a `video: true` official source whose title names one of the story's
 * games and that was published at most `CHANNEL_VIDEO_WINDOW_MS` from the story; the closest one wins.
 * Story 4929: the Name Reveal was collected late and clustered into another story. Only for a story with
 * games, and the caller only asks for a story about a video (`aboutVideo`).
 */
export function channelVideoFor(input: {
  candidates: ItemRow[];
  sources: Source[];
  games: string[];
  storyAt: Date;
}): { youtubeId: string; title: string; channel: string } | null {
  const games = gameKeys(input.games);
  if (games.length === 0) return null;
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const at = input.storyAt.getTime();
  let best: { item: ItemRow; source: Source; distance: number } | null = null;
  for (const item of input.candidates) {
    const source = byId.get(item.source_id);
    if (!source?.video || source.tier !== "oficial" || !isValidYoutubeId(item.video_id)) continue;
    const published = Date.parse(item.published_at ?? "");
    if (Number.isNaN(published) || Math.abs(published - at) > CHANNEL_VIDEO_WINDOW_MS) continue;
    const title = gameNameKey(item.title);
    if (!games.some((g) => has(title, g))) continue;
    const distance = Math.abs(published - at);
    if (!best || distance < best.distance) best = { item, source, distance };
  }
  if (!best) return null;
  return {
    youtubeId: best.item.video_id!,
    title: best.item.title,
    channel: best.source.name.replace(/\s*\((?:YouTube|canal)[^)]*\)\s*$/i, "").trim(),
  };
}

/**
 * Whether the story is about a video (a trailer, a gameplay, a reveal), or brings an official channel's
 * video: then the catalog's gameplay never closes the article as if it were the story's video.
 */
export function aboutVideo(story: Pick<StoryRow, "headline">, items: ItemRow[]): boolean {
  return ABOUT_VIDEO.test(story.headline) || items.some((i) => ABOUT_VIDEO.test(i.title) || isValidYoutubeId(i.video_id));
}
