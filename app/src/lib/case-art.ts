/**
 * Art of a game case (the "estojo" of the shelves in /jogos and /lancamentos), as an ordered list
 * of sources: the first that loads wins. Portrait art fills the case; wide art (Steam headers and
 * capsules) is shown whole over a blurred copy of itself, so a title is never cut. With no source
 * left, the case paints the generated art with the game's name. Client-safe (no database imports).
 */

export type CaseArtSource = { url: string; wide: boolean };

const STEAM_ASSETS = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";

/** Steam's portrait library art (600×900). Newer games keep it under a hashed path: may 404. */
export const steamPortraitUrl = (appId: number) => `${STEAM_ASSETS}/${appId}/library_600x900.jpg`;

/** Steam's store header (460×215), the wide fallback of games still without details. */
export const steamHeaderUrl = (appId: number) => `${STEAM_ASSETS}/${appId}/header.jpg`;

/** The app id inside a Steam CDN URL (`…/apps/<id>/…`), or null. */
export function steamAppIdFromUrl(url: string | null | undefined): number | null {
  const match = url?.match(/\/apps\/(\d+)\//);
  return match ? Number(match[1]) : null;
}

/** Ordered, deduplicated sources: portrait cover, Steam portrait, then the wide art. */
export function caseArt({
  coverUrl,
  steamAppId,
  wideUrl,
}: {
  coverUrl?: string | null;
  steamAppId?: number | null;
  wideUrl?: string | null;
}): CaseArtSource[] {
  const sources: CaseArtSource[] = [];
  const add = (url: string | null | undefined, wide: boolean) => {
    if (url && !sources.some((s) => s.url === url)) sources.push({ url, wide });
  };
  add(coverUrl, false);
  if (steamAppId) add(steamPortraitUrl(steamAppId), false);
  add(wideUrl ?? (steamAppId ? steamHeaderUrl(steamAppId) : null), true);
  return sources;
}
