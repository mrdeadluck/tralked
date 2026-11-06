import type { FetchFn } from "../collect/index.js";
import { mediaOf } from "../collect/media.js";
import { isValidYoutubeId } from "../collect/youtube.js";
import type { Source } from "../config.js";
import type { ItemRow, StoryRow } from "../db.js";
import { gameNameKey } from "../tralked.js";

/** YouTube videos looked up per story at most (oEmbed, no key, no AI). */
const MAX_LOOKUPS = 5;
const TIMEOUT_MS = 10_000;

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
    const colon = g.indexOf(":");
    if (colon > 0) out.add(gameNameKey(g.slice(0, colon)));
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

/**
 * The official video a source page embeds or links, when the story is about it (spec "Escolher o vídeo"):
 * - the channel is official: its name is one of the robot's official channels (`video: true` sources), or
 *   names one of the story's companies ("Bethesda Game Studios" for Bethesda);
 * - the title is about the story: it names one of the story's games (with or without the subtitle) or,
 *   when the story has no game, it is a trailer, gameplay, teaser or reveal.
 * A react or a news site's channel never passes. Title and channel come from YouTube's public oEmbed.
 */
export async function officialSourceVideo(
  input: { items: ItemRow[]; sources: Source[]; games: string[]; companies: string[] },
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
    const official = channels.has(channel) || companies.some((c) => has(channel, c));
    if (!official) continue;
    const title = gameNameKey(meta.title);
    const about = games.length > 0 ? games.some((g) => has(title, g)) : VIDEO_WORDS.test(meta.title);
    if (about) return { youtubeId: id, title: meta.title, channel: meta.author_name };
  }
  return null;
}

/**
 * Whether the story is about a video (a trailer, a gameplay, a reveal), or brings an official channel's
 * video: then the catalog's gameplay never closes the article as if it were the story's video.
 */
export function aboutVideo(story: Pick<StoryRow, "headline">, items: ItemRow[]): boolean {
  return ABOUT_VIDEO.test(story.headline) || items.some((i) => ABOUT_VIDEO.test(i.title) || isValidYoutubeId(i.video_id));
}
