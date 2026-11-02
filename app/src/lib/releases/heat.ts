/**
 * How big a release is, on one scale for every source, so lists can lead with the games people
 * care about (GTA VI before the shovelware that came out the same morning). Each signal is mapped
 * to roughly 0–1000 on a log scale; the strongest one counts in full and the others add a little:
 *
 * - Steam list position (`GameRelease.score` = 1000 − position in "popular new/upcoming"): at most
 *   400, so a list position alone never beats a game with real reviews, players or hype;
 * - IGDB hypes + ratings (`GameRelease.score` of IGDB rows): 300 ≈ 570, 3 000 ≈ 800;
 * - Steam reviews (`Game.steamReviewTotal`): 1 000 ≈ 570, 100 000 ≈ 950;
 * - SteamSpy owners lower bound (`Game.popularity`): 100 000 ≈ 400, 10 M ≈ 800;
 * - Steam concurrent players (`SteamPlayerCount.current`): 1 000 ≈ 510, 100 000 ≈ 850.
 */
export type HeatSignals = {
  /** Steam list scores of the game's Steam release rows (1000 − position). */
  steamList?: number[];
  /** IGDB scores (hypes + rating count) of its IGDB release rows. */
  igdb?: number[];
  reviews?: number | null;
  owners?: number | null;
  players?: number | null;
};

const log = (n: number | null | undefined) => Math.log10(1 + Math.max(0, n ?? 0));

export function releaseHeat(s: HeatSignals): number {
  const parts = [
    Math.max(0, ...(s.steamList ?? []).map((v) => (v - 500) * 0.8)),
    Math.max(0, ...(s.igdb ?? []).map((v) => log(v) * 230)),
    log(s.reviews) * 190,
    Math.max(0, log(s.owners) - 3) * 200,
    log(s.players) * 170,
  ].map((v) => Math.min(1000, v));
  const top = Math.max(...parts);
  const rest = parts.reduce((a, b) => a + b, 0) - top;
  return Math.round(top + rest * 0.12);
}

/** Heat from which a release is drawn heavier (a big launch, not one of many). */
export const BIG_RELEASE_HEAT = 560;
