/**
 * XP for hours played (Plano 4, F2): per game and platform, each milestone of accumulated real
 * platform playtime pays once. A milestone `m` (hours) is worth round(2000 · (m^0.7 − prev^0.7)),
 * so the running total is about 2000 · h^0.7 (10 h ≈ 10k XP, 100 h ≈ 50k, 3000 h ≈ 540k): every
 * extra hour is worth less than the one before, so idling a game pays far less than playing many.
 * A game with 0 minutes pays nothing.
 */

/** Hours milestones, ascending. */
export const PLAYTIME_MILESTONES_H = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

const EXPONENT = 0.7;
const SCALE = 2000;

/** XP of the milestone at `hours` (must be one of PLAYTIME_MILESTONES_H). */
export function milestoneXp(hours: number): number {
  const index = PLAYTIME_MILESTONES_H.indexOf(hours as (typeof PLAYTIME_MILESTONES_H)[number]);
  if (index < 0) throw new Error(`${hours} h is not a playtime milestone`);
  const previous = index === 0 ? 0 : PLAYTIME_MILESTONES_H[index - 1];
  return Math.round(SCALE * (hours ** EXPONENT - previous ** EXPONENT));
}

export type PlaytimeMilestone = { hours: number; xp: number };

/** Milestones reached with `playtimeMin` minutes of play (none for 0 or invalid values). */
export function reachedMilestones(playtimeMin: number): PlaytimeMilestone[] {
  if (!Number.isFinite(playtimeMin) || playtimeMin <= 0) return [];
  return PLAYTIME_MILESTONES_H.filter((h) => playtimeMin >= h * 60).map((hours) => ({
    hours,
    xp: milestoneXp(hours),
  }));
}

/** Total playtime XP of one game on one platform. */
export function playtimeXp(playtimeMin: number): number {
  return reachedMilestones(playtimeMin).reduce((sum, m) => sum + m.xp, 0);
}

/** Ledger `sourceKey` of a playtime milestone: `${platform}:${gameId}:${hours}`. */
export const playtimeSourceKey = (platform: string, gameId: string, hours: number) =>
  `${platform}:${gameId}:${hours}`;

/** Game of a playtime `sourceKey` (cuids never contain ":"). */
export function playtimeGameId(sourceKey: string): string {
  const parts = sourceKey.split(":");
  return parts.length === 3 ? parts[1] : "";
}
