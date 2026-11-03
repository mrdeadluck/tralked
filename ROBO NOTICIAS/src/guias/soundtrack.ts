import { z } from "zod";
import type { Ai } from "../ai/client.js";
import type { SearchHit } from "./websearch.js";

const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_CANDIDATES = 6;

export type Soundtrack = { youtubeId?: string; playlistId?: string; title: string; channel: string };
export type SoundtrackGame = { name: string; developer: string; publisher: string };

export interface SoundtrackDeps {
  /** `createWebSearch(...).search` */
  search: (query: string) => Promise<SearchHit[]>;
  /** Title and channel of a YouTube video or playlist URL; null when unavailable. Defaults to YouTube oEmbed. */
  oembed?: (url: string) => Promise<{ title: string; channel: string } | null>;
  model?: string;
  bucket?: "live" | "backfill";
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
  "official", "oficial", "games", "game", "studio", "studios", "entertainment", "interactive",
  "inc", "ltd", "llc", "co", "the", "music", "records", "channel",
]);
/** Name without generic words ("Official", "Games"...); the full name when that would leave almost nothing ("S-GAME"). */
const core = (s: string) => {
  const stripped = norm(s)
    .split(" ")
    .filter((w) => w && !GENERIC.has(w))
    .join(" ");
  return stripped.length >= 3 ? stripped : norm(s);
};

/** Channel is the developer's or publisher's own when their distinctive names contain one another. */
function channelMatches(channel: string, company: string): boolean {
  const c = core(channel);
  const k = core(company);
  return c.length >= 2 && k.length >= 2 && (c === k || c.includes(k) || k.includes(c));
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

const judgeSchema = z.object({
  official: z.boolean(),
  relation: z.enum(["developer", "publisher", "label", "composer", "none"]),
});

const JUDGE_SYSTEM =
  "You decide whether a YouTube channel is the OFFICIAL home of a game's soundtrack: the channel of the game's developer, " +
  "publisher, its record label, or the soundtrack's composer. Fan uploads, re-uploaders, music compilations and " +
  "unrelated channels are not official. When in doubt, answer official=false and relation=none.";

/** Official soundtrack on YouTube, or null. Accepts developer / publisher channels, or a label / composer the judge confirms. */
export async function findSoundtrack(
  ai: Ai,
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
      let official = channelMatches(meta.channel, game.developer) || channelMatches(meta.channel, game.publisher);
      if (!official) {
        const verdict = await ai.structured({
          bucket: deps.bucket ?? "backfill",
          purpose: "guia-soundtrack",
          model: deps.model ?? DEFAULT_MODEL,
          effort: "low",
          system: JUDGE_SYSTEM,
          user: `Game: ${game.name}\nDeveloper: ${game.developer}\nPublisher: ${game.publisher}\nChannel: ${meta.channel}\nVideo/playlist title: ${meta.title}`,
          schema: judgeSchema,
          maxTokens: 200,
        });
        official = verdict.official && verdict.relation !== "none";
      }
      if (official) return { ...ids, title: meta.title, channel: meta.channel };
    }
  }
  return null;
}
