import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { fetchStoreAssets, type StoreAssets } from "@/lib/integrations/steam/store";
import type { PoliteFetch } from "@/lib/integrations/steam/polite-fetch";

/**
 * Repairs the library art of games filled in before the store's asset service was read: newer
 * Steam apps keep their 600×900 portrait and their hero under a hashed folder, the plain path
 * probed then 404'd, so the case showed the store header squeezed in (and wide cards a lone
 * portrait). One GetItems request answers 100 apps.
 *
 * Only blanks and wide stand-ins are written: a cover that is missing or a header/capsule becomes
 * the portrait; a missing hero becomes the hero; the main capsule (616×353) is added as a "capsule"
 * media row for wide cards. Covers from SteamGridDB or IGDB stay.
 */

const PER_REQUEST = 100;

/** Wide store art kept as a "cover" (lib/case-art `isWideArt`), as database filters. */
const WIDE_COVER: Prisma.GameWhereInput[] = [
  { coverUrl: { contains: "/header." } },
  { coverUrl: { contains: "/capsule_" } },
];

const NEEDS_ART: Prisma.GameWhereInput = {
  OR: [{ coverUrl: null }, ...WIDE_COVER, { heroUrl: null }, { media: { none: { kind: "capsule", source: "steam" } } }],
};
const select = {
  id: true,
  steamAppId: true,
  coverUrl: true,
  heroUrl: true,
  media: { where: { kind: "capsule", source: "steam" }, select: { id: true }, take: 1 },
} as const;

/**
 * Games whose art the shelves show, best first: the releases of /lancamentos and the calendar
 * (released since `since` or still to come; often stubs with no details yet), then games with
 * details or popularity.
 */
export async function libraryArtCandidates(limit: number, since: Date) {
  const releases = await prisma.game.findMany({
    where: {
      steamAppId: { not: null },
      releases: { some: { OR: [{ date: { gte: since } }, { date: null }] } },
      AND: [NEEDS_ART],
    },
    orderBy: [{ popularity: "desc" }, { id: "asc" }],
    take: limit,
    select,
  });
  if (releases.length >= limit) return releases;
  const others = await prisma.game.findMany({
    where: {
      steamAppId: { not: null },
      id: { notIn: releases.map((g) => g.id) },
      OR: [{ detailsSyncedAt: { not: null } }, { popularity: { gt: 0 } }],
      AND: [NEEDS_ART],
    },
    orderBy: [{ popularity: "desc" }, { id: "asc" }],
    take: limit - releases.length,
    select,
  });
  return [...releases, ...others];
}

type Candidate = Awaited<ReturnType<typeof libraryArtCandidates>>[number];

const isWideCover = (url: string | null) => !!url && /\/(?:header|capsule_[^/]*)\.(?:jpg|png|webp)/i.test(url);

/** What to write for one game: the portrait over a blank or wide cover, the hero over a blank. */
export function libraryArtUpdate(game: Pick<Candidate, "coverUrl" | "heroUrl">, assets: StoreAssets | undefined) {
  const data: { coverUrl?: string; heroUrl?: string } = {};
  if (assets?.cover && (!game.coverUrl || isWideCover(game.coverUrl))) data.coverUrl = assets.cover.url;
  if (assets?.hero && !game.heroUrl) data.heroUrl = assets.hero.url;
  return data;
}

export type LibraryArtResult = { checked: number; covers: number; heroes: number; capsules: number; failed: number };

/** Up to `limit` games, `PER_REQUEST` per store request, until `deadline`. */
export async function repairLibraryArt(
  politeFetch: PoliteFetch,
  { limit = 1000, deadline = Infinity, now = new Date() }: { limit?: number; deadline?: number; now?: Date } = {},
): Promise<LibraryArtResult> {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const games = await libraryArtCandidates(limit, since);
  const result: LibraryArtResult = { checked: 0, covers: 0, heroes: 0, capsules: 0, failed: 0 };
  for (let i = 0; i < games.length && Date.now() < deadline; i += PER_REQUEST) {
    const chunk = games.slice(i, i + PER_REQUEST);
    let assets: Map<number, StoreAssets>;
    try {
      assets = await fetchStoreAssets(politeFetch, chunk.map((g) => g.steamAppId!));
    } catch (error) {
      console.warn("Library art: Steam GetItems failed", error);
      result.failed += chunk.length;
      continue;
    }
    for (const game of chunk) {
      result.checked++;
      const found = assets.get(game.steamAppId!);
      const data = libraryArtUpdate(game, found);
      if (data.coverUrl || data.heroUrl) await prisma.game.update({ where: { id: game.id }, data });
      if (data.coverUrl) result.covers++;
      if (data.heroUrl) result.heroes++;
      // The main capsule (616×353, key art with the logo) for wide cards (lib/art/frame).
      if (found?.capsule && game.media.length === 0) {
        await prisma.gameMedia.create({
          data: { gameId: game.id, kind: "capsule", order: 0, source: "steam", ...found.capsule },
        });
        result.capsules++;
      }
    }
  }
  return result;
}
