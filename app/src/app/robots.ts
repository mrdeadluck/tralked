import type { MetadataRoute } from "next";
import { forumIndexCached } from "@/lib/community/cached";
import { env } from "@/lib/env";
import { buildRobots } from "@/lib/seo/robots";

/**
 * Open to search crawlers, minus the private areas and the empty per-game listings: the forum
 * sections with content (every category, the games with topics) are read from the cached forum
 * index, refreshed with the forum tag when a thread is created or removed.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { categories, games } = await forumIndexCached();
  return buildRobots(env.APP_URL, [...categories.map((c) => c.slug), ...games.map((g) => g.slug)]);
}
