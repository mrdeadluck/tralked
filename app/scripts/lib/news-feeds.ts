import type { PrismaClient } from "@/generated/prisma/client";
import type { RecommendedFeed } from "@/lib/news/feed-catalog";

export type FeedReport = { added: RecommendedFeed[]; kept: { feed: RecommendedFeed; active: boolean; area: string }[] };

/**
 * Adds the curated feeds that are not registered yet (matched by URL). Idempotent: a second run
 * adds nothing. A feed already in the database is never changed, so whatever the admin did to it
 * (paused, renamed, moved to another area) stays. With `dryRun` nothing is written.
 */
export async function addRecommendedFeeds(
  db: PrismaClient,
  feeds: readonly RecommendedFeed[],
  options: { dryRun: boolean; active: boolean },
): Promise<FeedReport> {
  const existing = await db.newsFeed.findMany({
    where: { url: { in: feeds.map((f) => f.url) } },
    select: { url: true, active: true, area: true },
  });
  const byUrl = new Map(existing.map((f) => [f.url, f]));
  const report: FeedReport = { added: [], kept: [] };
  for (const feed of feeds) {
    const row = byUrl.get(feed.url);
    if (row) {
      report.kept.push({ feed, active: row.active, area: row.area });
      continue;
    }
    if (!options.dryRun) {
      // skipDuplicates: a feed added meanwhile (admin) is left alone instead of failing the run.
      await db.newsFeed.createMany({
        data: [{ name: feed.name, url: feed.url, area: feed.area, active: options.active }],
        skipDuplicates: true,
      });
    }
    report.added.push(feed);
  }
  return report;
}
