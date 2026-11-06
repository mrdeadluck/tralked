import { cacheLife, cacheTag } from "next/cache";
import { platformCredential } from "@/lib/integrations/availability";
import { hasPsnCatalogTrophiesDue } from "@/lib/sync/psn-catalog-trophies";
import { gameTag } from "./games-cached";

/**
 * Whether the game page should ask for the trophies of one of the game's PSN catalog lists. Cached
 * with the game's tag: the action that reads the list expires it (updateTag), so the loader then
 * disappears. Same shape as getRetroAchievementsDue.
 */
export async function getPsnTrophiesDue(gameId: string, slug: string): Promise<boolean> {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug));
  // False without a PSN credential: offline fixtures have no lists, so dev logs stay clean.
  return Boolean(platformCredential("psn")) && hasPsnCatalogTrophiesDue(gameId);
}
