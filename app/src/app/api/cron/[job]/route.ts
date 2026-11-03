import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import type { CronJob } from "@/lib/cron/schedules";
import { dispatchWorkers } from "@/lib/cron/workers";
import { env } from "@/lib/env";
import { runHighscoresJob } from "@/lib/highscores/job";
import { pruneViewBuckets } from "@/lib/news/views";
import { deleteOldNotifications } from "@/lib/notifications/retention";
import { notifyStreakRisk } from "@/lib/notifications/streak-risk";
import { NEWS_TAG } from "@/lib/queries/news";
import { refreshRarity, syncCatalog } from "@/lib/sync/catalog";
import { syncExternalNews } from "@/lib/sync/external-news";
import { syncStaleMedia } from "@/lib/sync/media";
import { syncStalePlatformAccounts } from "@/lib/sync/platform-user";
import { runIgdbCatalogJob } from "@/lib/sync/igdb-catalog";
import { RELEASES_TAG } from "@/lib/queries/releases";
import { runReleasesJob } from "@/lib/sync/releases";
import { runSteamCatalogJob } from "@/lib/sync/steam-catalog";
import { syncStaleUsers } from "@/lib/sync/user";

/**
 * Ceiling of one cron invocation (seconds): Vercel's limit without Fluid compute. Every job is
 * bounded well under it, by item count and, for the slow per-user syncs, by a shared deadline:
 * - catalog: 25 stalest games; rarity: 50 games; media: 20 games; news: the active feeds;
 *   notifications: two deletes (old notifications, old article view buckets) and one batch insert
 *   of "sua sequência acaba hoje" nudges (at most 1000);
 * - users: at most 50 Steam users and 50 s in all (STALE_USERS_BUDGET_MS; each user's catalog
 *   probing gets what is left, at most 45 s);
 * - platforms: at most 5 PSN/Xbox/RA accounts and 50 s in all;
 * - steam-catalog: 50 s in all (app list ≤ 40%, one SteamSpy page, store details with the rest);
 * - releases: 50 s in all (4 Steam store pages, ≤ 12 IGDB pages of console release dates);
 * - igdb-catalog: 50 s in all (import pages ≤ 60%, details batches of 500 with the rest);
 * - highscores: one indexed top-200 read and one insert per board (about 40 boards);
 * - workers: one GitHub API request per worker due (lib/cron/workers.ts), no database.
 * Work left over goes first in the next run. Schedules: CRON_SCHEDULES in @/lib/cron/schedules
 * (and the README).
 */
export const maxDuration = 300;

const JOBS: Record<CronJob, () => Promise<{ processed: number; failed?: number }>> = {
  catalog: () => syncCatalog(),
  rarity: () => refreshRarity(),
  users: () => syncStaleUsers(),
  platforms: () => syncStalePlatformAccounts(),
  media: () => syncStaleMedia(),
  news: async () => {
    const result = await syncExternalNews();
    // New headlines show on the cached news views (home, /noticias, articles): stale-while-revalidate.
    if (result.created > 0) revalidateTag(NEWS_TAG, "max");
    return result;
  },
  // Daily: notifications older than 90 days (they may quote people who left), article view
  // buckets older than 35 days (the lifetime total stays in Article.views), and the streak nudge
  // for players whose streak ends today (runs early in the Brazilian day).
  notifications: async () => {
    const [notifications, views] = [await deleteOldNotifications(), await pruneViewBuckets()];
    const streaks = await notifyStreakRisk();
    return { processed: notifications.processed + views.processed + streaks.processed };
  },
  // Hourly: full Steam catalog (app list, popularity, details), 50 s in all.
  "steam-catalog": () => runSteamCatalogJob(),
  // Every 6 h: Steam popular new/upcoming lists and IGDB release dates, 50 s in all.
  releases: async () => {
    const result = await runReleasesJob();
    // Home card, /lancamentos and the calendar show the new releases at once.
    revalidateTag(RELEASES_TAG, { expire: 0 });
    return result;
  },
  // Hourly: console catalog from IGDB (import pages, then details), 50 s in all; off without keys.
  "igdb-catalog": () => runIgdbCatalogJob(),
  // Daily, just after midnight in Sao Paulo: rank snapshot of every board (the highscores arrows).
  highscores: () => runHighscoresJob(),
  // Hourly: starts the GitHub Actions workers due this hour (their own schedules are unreliable).
  workers: () => dispatchWorkers(),
};

function isAuthorized(request: NextRequest): boolean {
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ job: string }> },
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job } = await params;
  const run = Object.hasOwn(JOBS, job) ? JOBS[job as CronJob] : undefined;
  if (!run) return NextResponse.json({ error: "unknown job" }, { status: 404 });

  const result = await run();
  return NextResponse.json({ job, ...result });
}
