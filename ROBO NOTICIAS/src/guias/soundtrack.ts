import type { Ai } from "../ai/client.js";
import type { SearchHit } from "./websearch.js";

const MAX_CANDIDATES = 6;

export type Soundtrack = { youtubeId?: string; playlistId?: string; title: string; channel: string };
/** `composer` and `label` are evidence from the game's credits; without them only developer / publisher channels are accepted. */
export type SoundtrackGame = { name: string; developer: string; publisher: string; composer?: string; label?: string };

export interface SoundtrackDeps {
  /** `createWebSearch(...).search` */
  search: (query: string) => Promise<SearchHit[]>;
  /** Title and channel of a YouTube video or playlist URL; null when unavailable. Defaults to YouTube oEmbed. */
  oembed?: (url: string) => Promise<{ title: string; channel: string } | null>;
}

export async function youtubeOembed(url: string): Promise<{ title: string; channel: string } | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { title?: string; author_name?: string };
    return j.title && j.author_name ? { title: j.title, channel: j.author_name } : null;
  } catch {
    return null;
  }
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const GENERIC = new Set([
  "official", "oficial", "games", "studio", "studios", "entertainment", "interactive",
  "inc", "ltd", "llc", "co", "the", "music", "records", "channel", "topic",
]);
/** Distinctive tokens of a channel / company name: lowercase, no " - Topic" suffix, no generic words. */
const core = (s: string) => {
  const tokens = norm(s.replace(/\s+-\s+topic$/i, "")).split(" ").filter(Boolean);
  const distinctive = tokens.filter((t) => !GENERIC.has(t));
  return (distinctive.length > 0 ? distinctive : tokens).join(" ");
};

/** The channel is the company's own when their distinctive names are equal ("Capcom Music Archive" is not Capcom). */
function channelMatches(channel: string, company: string | undefined): boolean {
  if (!company) return false;
  const c = core(channel);
  return c.length >= 3 && c === core(company);
}

/** Video or playlist id from a YouTube URL. */
export function parseYoutube(url: string): { youtubeId?: string; playlistId?: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return /^[\w-]{11}$/.test(id) ? { youtubeId: id } : null;
    }
    if (host !== "youtube.com" && host !== "music.youtube.com") return null;
    const v = u.searchParams.get("v");
    if (u.pathname === "/watch" && v && /^[\w-]{11}$/.test(v)) return { youtubeId: v };
    const list = u.searchParams.get("list");
    if (u.pathname === "/playlist" && list && /^[\w-]+$/.test(list)) return { playlistId: list };
    return null;
  } catch {
    return null;
  }
}

/** Official soundtrack on YouTube, or null: the channel must be the developer's, publisher's, label's or composer's (the last two only when the credits name them). In doubt, null. */
export async function findSoundtrack(
  _ai: Ai,
  game: SoundtrackGame,
  deps: SoundtrackDeps,
): Promise<Soundtrack | null> {
  const oembed = deps.oembed ?? youtubeOembed;
  const gameKey = norm(game.name);
  const queries = [`${game.name} official soundtrack`, `${game.name} OST youtube`];
  const seen = new Set<string>();
  let tried = 0;
  for (const q of queries) {
    for (const hit of await deps.search(q)) {
      const ids = parseYoutube(hit.url);
      if (!ids || seen.has(hit.url)) continue;
      seen.add(hit.url);
      if (!norm(hit.title).includes(gameKey)) continue;
      if (tried++ >= MAX_CANDIDATES) return null;
      const meta = await oembed(hit.url);
      if (!meta) continue;
      const official = [game.developer, game.publisher, game.label, game.composer].some((c) => channelMatches(meta.channel, c));
      if (official) return { ...ids, title: meta.title, channel: meta.channel };
    }
  }
  return null;
}
