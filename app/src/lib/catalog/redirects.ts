import { cacheLife, cacheTag } from "next/cache";
import { prisma } from "@/lib/db";
import { gameTag } from "@/lib/queries/games-cached";

/**
 * Old slugs of games that were merged into another (GameSlugRedirect). Only asked when a slug is
 * not a game: a hit costs one primary-key read, and the answer is cached with the old slug's game
 * tag (the merge expires it, so a slug that becomes a redirect is never served as a 404).
 */

type Resolve = (slug: string) => Promise<string | null>;

/** The slug the old one now points to, or null (a chain A→B→C is collapsed when it is written). */
export async function loadSlugRedirect(slug: string): Promise<string | null> {
  if (!slug || slug.length > 200) return null;
  const row = await prisma.gameSlugRedirect.findUnique({
    where: { fromSlug: slug },
    select: { game: { select: { slug: true } } },
  });
  return row?.game.slug ?? null;
}

/** `loadSlugRedirect` cached with the slug's game tag; what the pages use. */
export async function resolveSlugRedirect(slug: string): Promise<string | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug));
  return loadSlugRedirect(slug);
}

/** `/jogos/<kept>` plus the sub-path the visitor asked for ("/guia"), or null when the slug is unknown. */
export async function gameRedirectPath(slug: string, suffix = "", resolve: Resolve = resolveSlugRedirect): Promise<string | null> {
  const kept = await resolve(slug);
  return kept ? `/jogos/${kept}${suffix}` : null;
}

/** A game's forum section is named by its slug: `/forum/<old>` goes to `/forum/<kept>`. */
export async function forumRedirectPath(segment: string, resolve: Resolve = resolveSlugRedirect): Promise<string | null> {
  const kept = await resolve(segment);
  return kept ? `/forum/${kept}` : null;
}

/** `/galeria?jogo=<old>` with the same filters, now naming the kept game; null when nothing changes. */
export async function galleryRedirectHref(params: Record<string, string | string[] | undefined>,
  resolve: Resolve = resolveSlugRedirect,
): Promise<string | null> {
  const requested = Array.isArray(params.jogo) ? params.jogo[0] : params.jogo;
  if (!requested) return null;
  const kept = await resolve(requested);
  if (!kept) return null;
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    next.set(key, key === "jogo" ? kept : Array.isArray(value) ? value[0] : value);
  }
  return `/galeria?${next.toString()}`;
}
