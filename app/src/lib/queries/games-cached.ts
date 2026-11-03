import { cacheLife, cacheTag } from "next/cache";
import { getAchievementsOnly } from "./achievements-only";
import { getGame, getGuidePublic, hasGuidePreview } from "./games";

/** Cache tag shared by everything public about one game (page data, guide, metadata). */
export const gameTag = (slug: string) => `game:${slug}`;

/** Public guide (no per-user marks), cached so it lands in the static shell. */
export async function getGuideCached(slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug));
  return getGuidePublic(slug);
}

/** Public game data (no per-user progress), cached. */
export async function getGameCached(slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug));
  return getGame(slug);
}

/** Achievements-only guide page data for a game without a guide, cached. Null without achievements. */
export async function getAchievementsOnlyCached(slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug));
  return getAchievementsOnly(slug);
}

/**
 * Whether the game has an unpublished walkthrough staff can preview, cached: only the yes/no decides
 * the branch of the page, the guide itself is read uncached and only for staff (StaffGuidePreview).
 */
export async function hasGuidePreviewCached(slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug));
  return hasGuidePreview(slug);
}
