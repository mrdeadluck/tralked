/**
 * XP for hours played (Plano 4, F2): per game and platform, milestones of accumulated real
 * platform playtime, each paid once.
 *
 * - Nothing below 5 h in a game: launching a game (or leaving it idle) for a few hours pays
 *   nothing. The first paying milestone, 5 h, pays the whole value up to it: round(2000 · 5^0.7).
 * - Each later milestone `m` pays round(2000 · (m^0.7 − previous^0.7)), so from 5 h on the running
 *   total is about 2000 · h^0.7 (10 h ≈ 10k XP, 100 h ≈ 50k, 2500 h ≈ 480k). Every extra hour is
 *   worth less than the one before, so pouring hours into one game pays far less than playing
 *   many: concave by design.
 * - Breadth is capped too (lib/sync/playtime.ts): at most PLAYTIME_NEW_GAMES_PER_DAY games may
 *   start paying hours XP per UTC day and at most PLAYTIME_MAX_GAMES games ever, so a library of
 *   hundreds of idled games cannot be farmed. Games over the daily cap pay on a later day.
 */

/** Hours milestones, ascending (1 h and 2 h are tracked but pay nothing). */
export const PLAYTIME_MILESTONES_H = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

/** Below this many hours in a game, playtime pays no XP. */
export const PLAYTIME_MIN_PAID_H = 5;
/** Games that may start paying hours XP per user and UTC day. */
export const PLAYTIME_NEW_GAMES_PER_DAY = 10;
/** Distinct games that may ever pay hours XP per user (games already paying keep paying). */
export const PLAYTIME_MAX_GAMES = 150;

const EXPONENT = 0.7;
const SCALE = 2000;

/** Milestones that pay XP (5 h and up). */
export const PAID_MILESTONES_H = PLAYTIME_MILESTONES_H.filter((h) => h >= PLAYTIME_MIN_PAID_H);

/** XP of the milestone at `hours` (0 for the unpaid 1 h and 2 h; must be one of PLAYTIME_MILESTONES_H). */
export function milestoneXp(hours: number): number {
  const index = PLAYTIME_MILESTONES_H.indexOf(hours as (typeof PLAYTIME_MILESTONES_H)[number]);
  if (index < 0) throw new Error(`${hours} h is not a playtime milestone`);
  if (hours < PLAYTIME_MIN_PAID_H) return 0;
  // The first paying milestone pays everything up to it.
  const previous = hours === PLAYTIME_MIN_PAID_H ? 0 : PLAYTIME_MILESTONES_H[index - 1];
  return Math.round(SCALE * (hours ** EXPONENT - previous ** EXPONENT));
}

export type PlaytimeMilestone = { hours: number; xp: number };

/** Paying milestones reached with `playtimeMin` minutes of play (none below 5 h or for invalid values). */
export function reachedMilestones(playtimeMin: number): PlaytimeMilestone[] {
  if (!Number.isFinite(playtimeMin) || playtimeMin <= 0) return [];
  return PAID_MILESTONES_H.filter((h) => playtimeMin >= h * 60).map((hours) => ({
    hours,
    xp: milestoneXp(hours),
  }));
}

/** Total playtime XP of one game on one platform (before the per-user caps). */
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
