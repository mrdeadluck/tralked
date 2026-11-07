import { cacheLife, cacheTag } from "next/cache";
import { env } from "@/lib/env";
import { getLatestArticles, NEWS_TAG } from "@/lib/queries/news";
import { buildRss, FEED_PATH } from "@/lib/seo/news-feeds";

const ITEMS = 50;

async function rss() {
  "use cache";
  cacheLife("hours");
  cacheTag(NEWS_TAG);
  return buildRss(await getLatestArticles(ITEMS), env.APP_URL, FEED_PATH);
}

/** GET /feed.xml: RSS of the latest news (lib/seo/news-feeds.ts), linked from every page's <head>. */
export async function GET() {
  return new Response(await rss(), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=900" },
  });
}
