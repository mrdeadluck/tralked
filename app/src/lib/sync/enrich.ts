import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getIgdb, getSgdb } from "@/lib/integrations";
import type { PoliteFetch } from "@/lib/integrations/steam/polite-fetch";
import { fetchStoreReviews } from "@/lib/integrations/steam/store";
import type { WithDb } from "@/lib/worker/db-retry";
import { rethrowIfDatabaseDown } from "@/lib/worker/errors";
import { mediaQueue, syncGameMedia, type MediaDeps } from "./media";

/**
 * Catalog enrichment of scripts/catalog-enrich-worker.ts (GitHub Actions), straight against the
 * database, so the Vercel quota stays for the site:
 * - media: IGDB trailers, screenshots and artworks plus SteamGridDB art of the games still without
 *   them, most popular first (the cron's `media` job does 20 games every 6 h);
 * - reviews: Steam user review totals of the Steam games, most popular first, read again weekly.
 * Both lanes run in parallel until the time is up or their queue is empty. The small writes (a
 * game's review totals, a media attempt) go in groups of FLUSH_EVERY, one statement each, instead
 * of one round trip per game. A batch is the unit a lost database connection repeats (`withDb`).
 */

/** Steam reviews are read again after this long. */
export const REVIEWS_RECHECK_MS = 7 * 24 * 60 * 60_000;
const BATCH = 100;
/** Games whose small writes are grouped into one statement. */
const FLUSH_EVERY = 25;

export type EnrichLog = { info(message: string): void; error(message: string, error?: unknown): void };
export type LaneResult = { done: number; failed: number };

/** No retry: the unit runs once (tests, callers without a worker loop). */
const once: WithDb = (_label, unit) => unit();

/** Media of the queue's games, most popular first, until `stopAt`. */
export async function enrichMedia(
  stopAt: number,
  log: EnrichLog,
  deps: MediaDeps = { igdb: getIgdb(), sgdb: getSgdb() },
  now: () => number = Date.now,
  withDb: WithDb = once,
): Promise<LaneResult> {
  const result: LaneResult = { done: 0, failed: 0 };
  while (now() < stopAt) {
    const more = await withDb("media batch", async () => {
      const games = await prisma.game.findMany({
        where: mediaQueue(new Date(now())),
        orderBy: { popularity: "desc" },
        take: BATCH,
        select: { id: true },
      });
      if (games.length === 0) return false;
      // Attempts are marked either way, so a game that keeps failing does not hold the queue.
      const checked: { id: string; ok: boolean }[] = [];
      const flush = async () => {
        if (checked.length === 0) return;
        const rows = checked.splice(0);
        await prisma.game.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { mediaCheckedAt: new Date(now()) } });
        const ok = rows.filter((r) => r.ok).length;
        result.done += ok;
        result.failed += rows.length - ok;
      };
      for (const { id } of games) {
        if (now() >= stopAt) break;
        let ok = true;
        try {
          await syncGameMedia(id, deps);
        } catch (error) {
          rethrowIfDatabaseDown(error);
          ok = false;
          log.error(`Media: game ${id} failed`, error);
        }
        checked.push({ id, ok });
        if (checked.length >= FLUSH_EVERY) await flush();
      }
      await flush();
      log.info(`Media: ${result.done} games done, ${result.failed} failed`);
      return true;
    });
    if (!more) break;
  }
  return result;
}

type ReviewRow = { id: string; at: Date; positive: number | null; total: number | null };

/** One UPDATE for a group of games: totals of the ones read, the attempt time of all. */
async function writeReviews(rows: ReviewRow[]): Promise<void> {
  const values = Prisma.join(
    rows.map((r) => Prisma.sql`(${r.id}, ${r.at}::timestamp(3), ${r.positive}::int, ${r.total}::int)`),
  );
  await prisma.$executeRaw`
    UPDATE "Game" AS g SET
      "steamReviewsAt" = v.at,
      "steamReviewPositive" = COALESCE(v.pos, g."steamReviewPositive"),
      "steamReviewTotal" = COALESCE(v.tot, g."steamReviewTotal"),
      "updatedAt" = v.at
    FROM (VALUES ${values}) AS v(id, at, pos, tot)
    WHERE g.id = v.id`;
}

/** Steam review totals of listed Steam games never read or read over a week ago, until `stopAt`. */
export async function enrichReviews(
  stopAt: number,
  politeFetch: PoliteFetch,
  log: EnrichLog,
  now: () => number = Date.now,
  withDb: WithDb = once,
): Promise<LaneResult> {
  const result: LaneResult = { done: 0, failed: 0 };
  while (now() < stopAt) {
    const more = await withDb("reviews batch", async () => {
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
      if (games.length === 0) return false;
      const pending: ReviewRow[] = [];
      const flush = async () => {
        if (pending.length === 0) return;
        const rows = pending.splice(0);
        await writeReviews(rows);
        const read = rows.filter((r) => r.total !== null).length;
        result.done += read;
        result.failed += rows.length - read;
      };
      for (const game of games) {
        if (now() >= stopAt) break;
        let reviews = null;
        try {
          reviews = await fetchStoreReviews(politeFetch, game.steamAppId!);
        } catch (error) {
          log.error(`Reviews: app ${game.steamAppId} failed`, error);
        }
        pending.push({ id: game.id, at: new Date(now()), positive: reviews?.positive ?? null, total: reviews?.total ?? null });
        if (pending.length >= FLUSH_EVERY) await flush();
      }
      await flush();
      log.info(`Reviews: ${result.done} games read, ${result.failed} failed`);
      return true;
    });
    if (!more) break;
  }
  return result;
}
