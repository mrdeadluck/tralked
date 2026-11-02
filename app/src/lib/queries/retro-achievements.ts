import { cacheLife, cacheTag } from "next/cache";
import { hasRetroAchievementsDue } from "@/lib/sync/retro-achievements";
import { gameTag } from "./games-cached";

/**
 * Whether the game page should ask for the game's RetroAchievements list (item 15). Cached with the
 * game's tag: the action that reads the list expires it (updateTag), so the loader then disappears.
 */
export async function getRetroAchievementsDue(gameId: string, slug: string): Promise<boolean> {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug));
  return hasRetroAchievementsDue(gameId);
}
