import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { refreshRarity, syncCatalog } from "@/lib/sync/catalog";
import { syncExternalNews } from "@/lib/sync/external-news";
import { syncStaleMedia } from "@/lib/sync/media";
import { syncStalePlatformAccounts } from "@/lib/sync/platform-user";
import { syncStaleUsers } from "@/lib/sync/user";

// Each job is bounded (a fixed number of games/users per run) so it fits in one invocation.
const JOBS: Record<string, () => Promise<{ processed: number; failed?: number }>> = {
  catalog: () => syncCatalog(),
  rarity: () => refreshRarity(),
  users: () => syncStaleUsers(),
  platforms: () => syncStalePlatformAccounts(),
  media: () => syncStaleMedia(),
  news: () => syncExternalNews(),
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
  const run = Object.hasOwn(JOBS, job) ? JOBS[job] : undefined;
  if (!run) return NextResponse.json({ error: "unknown job" }, { status: 404 });

  const result = await run();
  return NextResponse.json({ job, ...result });
}
