import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { z } from "zod";
import type { FetchFn } from "../collect/index.js";
import { mediaOf } from "../collect/media.js";
import type { ItemRow } from "../db.js";

/** A post on X the article embeds (the site's `post` block). */
export type XPost = { url: string; authorName: string; authorHandle: string; text: string; postedAt?: string };

export type XProfile = { handle: string; name: string };

const MAX_POSTS = 2;
/** oEmbed lookups per story at most (public endpoint, no key, no AI). */
const MAX_LOOKUPS = 6;
const TIMEOUT_MS = 10_000;

const ProfilesSchema = z.array(z.object({ handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/), name: z.string().min(1) }));

/** `config/perfis-x.json`: official profiles of games, companies and platforms (handles checked on X). */
export function loadXProfiles(path = "config/perfis-x.json"): XProfile[] {
  return ProfilesSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

type Embed = { authorName: string; authorHandle: string; text: string; postedAt?: string };

/** Text, author and date of a post from X's public oEmbed (`publish.twitter.com/oembed`); null on any failure. */
async function oembed(url: string, fallbackHandle: string, fetchFn: FetchFn): Promise<Embed | null> {
  const params = new URLSearchParams({ url, omit_script: "true", dnt: "true" });
  try {
    const res = await fetchFn(`https://publish.twitter.com/oembed?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { author_name?: unknown; author_url?: unknown; html?: unknown };
    if (typeof body.html !== "string" || typeof body.author_name !== "string") return null;
    const { document } = parseHTML(`<div id="root">${body.html}</div>`);
    const p = document.querySelector("blockquote p");
    if (!p) return null;
    for (const a of Array.from(p.querySelectorAll("a"))) if (/^pic\.(twitter|x)\.com\//.test(a.textContent?.trim() ?? "")) a.remove();
    const text = (p.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const links = Array.from(document.querySelectorAll("blockquote > a"));
    const when = Date.parse(`${links.at(-1)?.textContent?.trim() ?? ""} 12:00 UTC`);
    const fromUrl = typeof body.author_url === "string" ? /\/([A-Za-z0-9_]{1,15})\/?$/.exec(body.author_url)?.[1] : undefined;
    return {
      authorName: body.author_name.trim(),
      authorHandle: fromUrl ?? fallbackHandle,
      text,
      ...(Number.isFinite(when) ? { postedAt: new Date(when).toISOString() } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The X posts the article embeds (spec "Incorporar posts do X"): only posts the sources' pages embed or
 * link, in the order they appear, at most 2. A post enters when:
 * - its author is an official profile (`config/perfis-x.json`); or
 * - the sources quote its author (by name or @handle): the statement is the news; or
 * - the story is a rumor (a leaker's post, which the text attributes to its author).
 * A post X does not describe (deleted, private, offline) is left out.
 */
export async function storyPosts(
  input: { items: ItemRow[]; rumor: boolean; sourceTexts: string[] },
  fetchFn: FetchFn,
  profiles: XProfile[],
): Promise<XPost[]> {
  const official = new Set(profiles.map((p) => p.handle.toLowerCase()));
  const sources = input.sourceTexts.join("\n").toLowerCase();
  const quoted = (e: Embed) =>
    sources.includes(`@${e.authorHandle.toLowerCase()}`) || (e.authorName.length >= 4 && sources.includes(e.authorName.toLowerCase()));

  const seen = new Set<string>();
  const candidates = input.items.flatMap((i) => mediaOf(i).posts).filter((p) => !seen.has(p.statusId) && seen.add(p.statusId));
  const out: XPost[] = [];
  for (const post of candidates.slice(0, MAX_LOOKUPS)) {
    if (out.length >= MAX_POSTS) break;
    const e = await oembed(post.url, post.handle, fetchFn);
    if (!e) continue;
    if (!(official.has(e.authorHandle.toLowerCase()) || quoted(e) || input.rumor)) continue;
    out.push({ url: `https://x.com/${e.authorHandle}/status/${post.statusId}`, ...e });
  }
  return out;
}
