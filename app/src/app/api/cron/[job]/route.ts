import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { CronJob } from "@/lib/cron/schedules";
import { env } from "@/lib/env";
import { deleteOldNotifications } from "@/lib/notifications/retention";
import { refreshRarity, syncCatalog } from "@/lib/sync/catalog";
import { syncExternalNews } from "@/lib/sync/external-news";
import { syncStaleMedia } from "@/lib/sync/media";
import { syncStalePlatformAccounts } from "@/lib/sync/platform-user";
import { runSteamCatalogJob } from "@/lib/sync/steam-catalog";
import { syncStaleUsers } from "@/lib/sync/user";

/**
 * Ceiling of one cron invocation (seconds): Vercel's limit without Fluid compute. Every job is
 * bounded well under it, by item count and, for the slow per-user syncs, by a shared deadline:
 * - catalog: 25 stalest games; rarity: 50 games; media: 20 games; news: the active feeds;
 *   notifications: one delete;
 * - users: at most 50 Steam users and 50 s in all (STALE_USERS_BUDGET_MS; each user's catalog
 *   probing gets what is left, at most 45 s);
 * - platforms: at most 5 PSN/Xbox/RA accounts and 50 s in all;
 * - steam-catalog: 50 s in all (app list ≤ 40%, one SteamSpy page, store details with the rest).
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
  news: () => syncExternalNews(),
  // Daily: notifications older than 90 days (they may quote people who left).
  notifications: () => deleteOldNotifications(),
  // Hourly: full Steam catalog (app list, popularity, details), 50 s in all.
  "steam-catalog": () => runSteamCatalogJob(),
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
