import type { MetadataRoute } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { env } from "@/lib/env";
import { NEWS_TAG } from "@/lib/queries/news";
import { buildSitemap, loadSitemapData } from "@/lib/seo/sitemap";

async function sitemapData() {
  "use cache";
  cacheLife("hours");
  cacheTag(NEWS_TAG);
  return loadSitemapData();
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap(await sitemapData(), env.APP_URL);
}
