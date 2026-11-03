import type { Ai } from "../ai/client.js";
import type { FetchPage } from "./sources.js";
import type { SearchHit } from "./websearch.js";

const MAX_CANDIDATES = 6;

export type Soundtrack = { youtubeId?: string; playlistId?: string; title: string; channel: string };
/** `composer` and `label` are evidence from the game's credits; without them only developer / publisher channels are accepted. */
export type SoundtrackGame = { name: string; developer: string; publisher: string; composer?: string; label?: string };

/** What YouTube's oEmbed says of a video or playlist: its title, the channel's name and the channel's page. */
export type OembedMeta = { title: string; channel: string; channelUrl?: string };

export interface SoundtrackDeps {
  /** `createWebSearch(...).search` */
  search: (query: string) => Promise<SearchHit[]>;
  /** The polite page reader (robots.txt, host interval): the default `oembed` reads through it. */
  fetchPage?: FetchPage;
  /** oEmbed of a YouTube URL; null when unavailable. Defaults to `youtubeOembed` through `fetchPage`. */
  oembed?: (url: string) => Promise<OembedMeta | null>;
}

/** YouTube oEmbed of a video or playlist URL, read through the polite fetch; null when unavailable. */
export async function youtubeOembed(url: string, fetchPage: FetchPage): Promise<OembedMeta | null> {
  const page = await fetchPage(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  if (page.status !== "ok") return null;
  try {
    const j = JSON.parse(page.html ?? page.text ?? "") as { title?: unknown; author_name?: unknown; author_url?: unknown };
    if (typeof j.title !== "string" || typeof j.author_name !== "string" || !j.title || !j.author_name) return null;
    return { title: j.title, channel: j.author_name, ...(typeof j.author_url === "string" ? { channelUrl: j.author_url } : {}) };
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

/**
 * The handle or custom name in a channel's URL ("https://www.youtube.com/@SGAMEOfficial" -> "SGAMEOfficial");
 * undefined for a bare channel id, which says nothing about whose channel it is.
 */
export function channelHandle(channelUrl: string | undefined): string | undefined {
  if (!channelUrl) return undefined;
  try {
    const u = new URL(channelUrl);
    if (u.hostname.replace(/^www\.|^m\./, "") !== "youtube.com") return undefined;
    const path = decodeURIComponent(u.pathname);
    return /^\/@([^/]+)/.exec(path)?.[1] ?? /^\/(?:c|user)\/([^/]+)/.exec(path)?.[1];
  } catch {
    return undefined;
  }
}

/** What may follow the company's name in its handle: "@SGAMEOfficial", "@CapcomUSA_" are its; "@sgamefans" is not. */
const HANDLE_TAIL = /^(?:official|oficial|games?|studios?|music|musica|records|recordings|label|ost|soundtrack|channel|global|jp|en|us|tv|inc|ltd|\d)*$/;

/** A display name can be anyone's; the handle is unique: it must be the company's name too. */
function handleMatches(handle: string, company: string | undefined): boolean {
  if (!company) return false;
  const compact = (s: string) => norm(s).replace(/ /g, "");
  const h = compact(handle.replace(/-topic$/i, ""));
  const c = compact(core(company));
  return c.length >= 3 && h.startsWith(c) && HANDLE_TAIL.test(h.slice(c.length));
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

/**
 * Official soundtrack on YouTube, or null: the channel must be the developer's, publisher's, label's or composer's
 * (the last two only when the credits name them), by its name AND by its handle in the channel URL (a display name
 * can be copied, a handle cannot). In doubt, null.
 */
export async function findSoundtrack(
  _ai: Ai,
  game: SoundtrackGame,
  deps: SoundtrackDeps,
): Promise<Soundtrack | null> {
  const fetchPage = deps.fetchPage;
  const oembed = deps.oembed ?? (fetchPage ? (url: string) => youtubeOembed(url, fetchPage) : async () => null);
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
      const handle = channelHandle(meta.channelUrl);
      const official =
        handle !== undefined &&
        [game.developer, game.publisher, game.label, game.composer].some((c) => channelMatches(meta.channel, c) && handleMatches(handle, c));
      if (official) return { ...ids, title: meta.title, channel: meta.channel };
    }
  }
  return null;
}
