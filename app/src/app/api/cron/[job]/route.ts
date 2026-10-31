import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { CronJob } from "@/lib/cron/schedules";
import { env } from "@/lib/env";
import { deleteOldNotifications } from "@/lib/notifications/retention";
import { refreshRarity, syncCatalog } from "@/lib/sync/catalog";
import { syncExternalNews } from "@/lib/sync/external-news";
import { syncStaleMedia } from "@/lib/sync/media";
import { syncStalePlatformAccounts } from "@/lib/sync/platform-user";
import { syncStaleUsers } from "@/lib/sync/user";

// Each job is bounded (a fixed number of games/users per run) so it fits in one invocation.
// Schedules: CRON_SCHEDULES in @/lib/cron/schedules (and the README).
const JOBS: Record<CronJob, () => Promise<{ processed: number; failed?: number }>> = {
  catalog: () => syncCatalog(),
  rarity: () => refreshRarity(),
  users: () => syncStaleUsers(),
  platforms: () => syncStalePlatformAccounts(),
  media: () => syncStaleMedia(),
  news: () => syncExternalNews(),
  // Daily: notifications older than 90 days (they may quote people who left).
  notifications: () => deleteOldNotifications(),
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
