import { cacheLife, cacheTag } from "next/cache";
import { env } from "@/lib/env";
import { getLatestArticles, NEWS_TAG } from "@/lib/queries/news";
import { buildNewsSitemap } from "@/lib/seo/news-feeds";

/** Two days of news is ~40–60 articles at the robot's pace; 200 leaves plenty of room. */
const RECENT = 200;

async function newsSitemap() {
  "use cache";
  cacheLife("hours");
  cacheTag(NEWS_TAG);
  return buildNewsSitemap(await getLatestArticles(RECENT), env.APP_URL, new Date());
}

/** GET /sitemap-noticias.xml: the Google News sitemap (lib/seo/news-feeds.ts), listed in robots.txt. */
export async function GET() {
  return new Response(await newsSitemap(), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" },
  });
}
