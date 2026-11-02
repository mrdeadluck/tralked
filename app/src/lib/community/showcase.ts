import { cacheLife } from "next/cache";
import type { Hues } from "@/components/art/GameArt";
import { prisma } from "@/lib/db";
import { safeMediaUrl } from "@/lib/queries/game-profile";
import { artHues, hashSeed } from "@/lib/queries/news";

/** One tile of an empty community page's mosaic: a popular game and one of its official images. */
export type ShowcaseShot = {
  slug: string;
  name: string;
  /** Official screenshot or artwork (IGDB, Steam); null in seed fixtures (generated art instead). */
  url: string | null;
  seed: number;
  hues: Hues;
};

/**
 * The most popular catalog games with an official image each, for the empty gallery and forum: a
 * mosaic of what people play instead of a dashed box. Games with a real image come first.
 */
export async function showcaseShots(limit = 3): Promise<ShowcaseShot[]> {
  const games = await prisma.game.findMany({
    where: { stub: false },
    orderBy: [{ popularity: "desc" }, { name: "asc" }],
    take: limit * 4,
    select: {
      slug: true,
      name: true,
      heroUrl: true,
      media: {
        where: { kind: { in: ["screenshot", "artwork"] } },
        orderBy: [{ kind: "desc" }, { order: "asc" }],
        select: { id: true, url: true },
        take: 3,
      },
    },
  });
  const shots = games.map((game) => {
    const media = game.media.find((m) => safeMediaUrl(m.url) !== null);
    const url = safeMediaUrl(media?.url) ?? safeMediaUrl(game.heroUrl);
    return {
      slug: game.slug,
      name: game.name,
      url,
      seed: hashSeed(media?.id ?? game.slug),
      hues: artHues(game.slug, game.slug),
    };
  });
  // Real images first (stable within each group), then generated art for the rest.
  return [...shots.filter((s) => s.url), ...shots.filter((s) => !s.url)].slice(0, limit);
}

/** `showcaseShots`, cached: popularity moves slowly. */
export async function showcaseShotsCached(limit = 3): Promise<ShowcaseShot[]> {
  "use cache";
  cacheLife("hours");
  return showcaseShots(limit);
}
