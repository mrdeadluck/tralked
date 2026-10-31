import { cacheLife, cacheTag } from "next/cache";
import { getGame, getGuidePublic } from "./games";

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