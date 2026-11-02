import { prisma } from "@/lib/db";
import { getIgdb, getSgdb } from "@/lib/integrations";
import type { PoliteFetch } from "@/lib/integrations/steam/polite-fetch";
import { fetchStoreReviews } from "@/lib/integrations/steam/store";
import { markMediaChecked, mediaQueue, syncGameMedia, type MediaDeps } from "./media";

/**
 * Catalog enrichment of scripts/catalog-enrich-worker.ts (GitHub Actions), straight against the
 * database, so the Vercel quota stays for the site:
 * - media: IGDB trailers, screenshots and artworks plus SteamGridDB art of the games still without
 *   them, most popular first (the cron's `media` job does 20 games every 6 h);
 * - reviews: Steam user review totals of the Steam games, most popular first, read again weekly.
 * Both lanes run in parallel until the time is up or their queue is empty.
 */

/** Steam reviews are read again after this long. */
export const REVIEWS_RECHECK_MS = 7 * 24 * 60 * 60_000;
const BATCH = 100;

export type EnrichLog = { info(message: string): void; error(message: string, error?: unknown): void };
export type LaneResult = { done: number; failed: number };

/** Media of the queue's games, most popular first, until `stopAt`. */
export async function enrichMedia(
  stopAt: number,
  log: EnrichLog,
  deps: MediaDeps = { igdb: getIgdb(), sgdb: getSgdb() },
  now: () => number = Date.now,
): Promise<LaneResult> {
  const result: LaneResult = { done: 0, failed: 0 };
  while (now() < stopAt) {
    const games = await prisma.game.findMany({
      where: mediaQueue(new Date(now())),
      orderBy: { popularity: "desc" },
      take: BATCH,
      select: { id: true },
    });
    if (games.length === 0) break;
    for (const { id } of games) {
      if (now() >= stopAt) break;
      try {
        await syncGameMedia(id, deps);
        result.done++;
      } catch (error) {
        result.failed++;
        log.error(`Media: game ${id} failed`, error);
      }
      // Marked either way, so a game that keeps failing does not hold the queue.
      await markMediaChecked(id, new Date(now()));
    }
    log.info(`Media: ${result.done} games done, ${result.failed} failed`);
  }
  return result;
}

/** Steam review totals of listed Steam games never read or read over a week ago, until `stopAt`. */
export async function enrichReviews(
  stopAt: number,
  politeFetch: PoliteFetch,
  log: EnrichLog,
  now: () => number = Date.now,
): Promise<LaneResult> {
  const result: LaneResult = { done: 0, failed: 0 };
  while (now() < stopAt) {
    const stale = new Date(now() - REVIEWS_RECHECK_MS);
    const games = await prisma.game.findMany({
      where: {
        stub: false,
        steamAppId: { not: null },
        OR: [{ steamReviewsAt: null }, { steamReviewsAt: { lt: stale } }],
      },
      orderBy: [{ steamReviewsAt: { sort: "asc", nulls: "first" } }, { popularity: "desc" }],
      take: BATCH,
      select: { id: true, steamAppId: true },
    });
    if (games.length === 0) break;
    for (const game of games) {
      if (now() >= stopAt) break;
      let reviews = null;
      try {
        reviews = await fetchStoreReviews(politeFetch, game.steamAppId!);
        result.done++;
      } catch (error) {
        result.failed++;
        log.error(`Reviews: app ${game.steamAppId} failed`, error);
      }
      await prisma.game.update({
        where: { id: game.id },
        data: {
          steamReviewsAt: new Date(now()),
          ...(reviews && { steamReviewPositive: reviews.positive, steamReviewTotal: reviews.total }),
        },
      });
    }
    log.info(`Reviews: ${result.done} games read, ${result.failed} failed`);
  }
  return result;
}
