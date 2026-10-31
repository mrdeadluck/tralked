import { cacheLife, cacheTag } from "next/cache";
import { getPlayerHeader } from "./players";

/** Cache tag of one player's public header (profile page shell and metadata). Case-insensitive. */
export const playerTag = (handle: string) => `player:${handle.toLowerCase()}`;

/**
 * Handle, display name and visibility of a player, cached so the profile page can answer a real
 * 404 and its metadata before any Suspense boundary. Invalidated by `playerTag` when the profile
 * changes visibility or the account is deleted; short-lived otherwise (Steam renames, sign-ups).
 */
export async function getPlayerHeaderCached(handle: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(playerTag(handle));
  return getPlayerHeader(handle);
}
