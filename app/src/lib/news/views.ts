import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";

/**
 * Article view counter (item 11), built to be cheap on Neon and on Vercel's CPU budget:
 * - the page itself stays cached; a small beacon (components/news/ArticleViewBeacon) posts to
 *   /api/views after the article rendered in a visible tab, so prefetches and prerenders never count;
 * - the route drops bots (user agent) and prefetch requests, and repeat views of the same article
 *   by the same visitor within VIEW_DEDUPE_MS (in memory per server instance; the browser also
 *   remembers recent views in localStorage);
 * - one SQL statement per counted view: Article.views + 1 and the day's ArticleViewDaily bucket
 *   + 1 (an upsert), never one row per view;
 * - "Mais visualizadas" sums the last VIEW_WINDOW_DAYS buckets; the daily cron prunes buckets
 *   older than VIEW_BUCKET_RETENTION_DAYS.
 */

/** Same visitor, same article: counted once in this window. */
export const VIEW_DEDUPE_MS = 30 * 60_000;
/** "Mais visualizadas" looks at the last 7 local days (today included). */
export const VIEW_WINDOW_DAYS = 7;
/** Daily buckets kept (the lifetime total stays in Article.views). */
export const VIEW_BUCKET_RETENTION_DAYS = 35;

const DAY_MS = 86_400_000;

// Crawlers, link previewers, headless browsers and HTTP libraries. Real browsers never match.
const BOT_UA =
  /bot|crawl|spider|slurp|archiver|facebookexternalhit|embedly|preview|lighthouse|pagespeed|headless|phantomjs|puppeteer|playwright|selenium|curl|wget|python-requests|python-urllib|httpclient|axios|node-fetch|undici|go-http|java\/|okhttp|scrapy|feedfetcher|monitor|uptime|pingdom|validator/i;

/** True for requests that do not come from a person's browser (or say nothing at all). */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = userAgent?.trim() ?? "";
  if (ua.length < 20) return true;
  return BOT_UA.test(ua);
}

/** True for prefetch / prerender requests (Chrome, Safari and Firefox mark them). */
export function isPrefetchRequest(headers: Headers): boolean {
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""} ${headers.get("x-purpose") ?? ""}`;
  return /prefetch|prerender|preview/i.test(purpose) || headers.get("x-moz") === "prefetch";
}

/**
 * Crude per-instance memory of recent views ("visitor:article" -> time). Bounded: when it grows
 * past `max` entries, expired ones go, and if that is not enough the oldest half goes too.
 */
export class RecentViews {
  private seen = new Map<string, number>();

  constructor(
    private windowMs = VIEW_DEDUPE_MS,
    private max = 20_000,
  ) {}

  /** Records the view; false when the same key was already seen within the window. */
  take(key: string, now: number = Date.now()): boolean {
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.seen.delete(key);
    this.seen.set(key, now);
    if (this.seen.size > this.max) this.prune(now);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }

  private prune(now: number) {
    for (const [key, at] of this.seen) if (now - at >= this.windowMs) this.seen.delete(key);
    if (this.seen.size <= this.max) return;
    let drop = Math.ceil(this.seen.size / 2);
    // Maps iterate in insertion order, and `take` re-inserts on every view: oldest first.
    for (const key of this.seen.keys()) {
      if (drop-- <= 0) break;
      this.seen.delete(key);
    }
  }
}

/**
 * Counts one view of a published article: lifetime total and today's bucket, in one statement.
 * Returns false when the article does not exist or is not published (nothing is written).
 */
export async function recordArticleView(articleId: string, now: Date = new Date()): Promise<boolean> {
  const day = toLocalDay(now);
  const rows = await prisma.$queryRaw<{ articleId: string }[]>`
    WITH counted AS (
      UPDATE "Article" SET "views" = "views" + 1
      WHERE "id" = ${articleId} AND "status" = 'published'
      RETURNING "id"
    )
    INSERT INTO "ArticleViewDaily" ("articleId", "day", "count")
    SELECT "id", ${day}, 1 FROM counted
    ON CONFLICT ("articleId", "day") DO UPDATE SET "count" = "ArticleViewDaily"."count" + 1
    RETURNING "articleId"`;
  return rows.length > 0;
}

/** First local day of the "last N days" window that ends today. */
export function windowStartDay(now: Date, days: number = VIEW_WINDOW_DAYS): string {
  return toLocalDay(new Date(now.getTime() - (days - 1) * DAY_MS));
}

/** Article ids by views in the last `days` local days, most viewed first, with their totals. */
export async function mostViewedArticleIds(
  limit: number,
  now: Date = new Date(),
  days: number = VIEW_WINDOW_DAYS,
): Promise<{ articleId: string; views: number }[]> {
  const rows = await prisma.articleViewDaily.groupBy({
    by: ["articleId"],
    where: { day: { gte: windowStartDay(now, days) }, article: { status: "published" } },
    _sum: { count: true },
    orderBy: [{ _sum: { count: "desc" } }, { articleId: "asc" }],
    take: limit,
  });
  return rows.map((r) => ({ articleId: r.articleId, views: r._sum.count ?? 0 })).filter((r) => r.views > 0);
}

/** Daily cron: drops view buckets older than the retention window. */
export async function pruneViewBuckets(now: Date = new Date()): Promise<{ processed: number }> {
  const cutoff = toLocalDay(new Date(now.getTime() - VIEW_BUCKET_RETENTION_DAYS * DAY_MS));
  const { count } = await prisma.articleViewDaily.deleteMany({ where: { day: { lt: cutoff } } });
  return { processed: count };
}
