/** How many games take turns behind the profile header. */
export const BACKDROP_GAMES = 3;

type BackdropCandidate = { gameId: string; art: { heroUrl: string | null; coverUrl: string | null } };

/**
 * The art behind the profile header: the wide art (hero, artwork or screenshot) of the last games
 * played, newest first and one per game, completed with the most played ones when fewer than
 * BACKDROP_GAMES have a date or wide art. With no wide art anywhere, the most played game's cover,
 * as before; with no game at all, nothing.
 */
export function pickBackdrops(recent: BackdropCandidate[], mostPlayed: BackdropCandidate[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const { gameId, art } of [...recent, ...mostPlayed]) {
    if (urls.length >= BACKDROP_GAMES) break;
    if (seen.has(gameId) || !art.heroUrl) continue;
    seen.add(gameId);
    urls.push(art.heroUrl);
  }
  if (urls.length > 0) return urls;
  const cover = mostPlayed[0]?.art.coverUrl;
  return cover ? [cover] : [];
}
