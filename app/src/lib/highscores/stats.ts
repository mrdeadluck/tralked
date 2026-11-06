import { acervoPoints } from "@/lib/engine/attributes";

/** `all` merges every platform (one game on Steam and PSN is one game). */
export const RANK_SCOPES = ["all", "steam", "psn", "xbox", "retro"] as const;
export type RankScope = (typeof RANK_SCOPES)[number];

export function isRankScope(value: string): value is RankScope {
  return (RANK_SCOPES as readonly string[]).includes(value);
}

/** Same thresholds as `rarityTier` (engine/xp): rara or rarer, and lendária. */
export const RARE_MAX_PCT = 20;
export const LEGENDARY_MAX_PCT = 3;

export type RankStatsValues = {
  playtimeMin: number;
  achievements: number;
  rareAchievements: number;
  legendaryAchievements: number;
  perfectGames: number;
  gamesOwned: number;
  gamesPlayed: number;
  acervo: number;
};

export type RankStatsInput = {
  /** Every UserGame row of the user. */
  games: { gameId: string; platform: string; playtimeMin: number }[];
  /** Valid (non-suspicious) unlocks only. */
  unlocks: { gameId: string; platform: string; globalPct: number | null }[];
  /**
   * The profile's "Tralked" (lib/character/counts platinumCount: one per list/version at 100%), in
   * total and by platform: the "Tralked" board (`perfectGames`).
   */
  tralked: { tralked: number; tralkedByPlatform: Record<string, number> };
};

const inScope = (scope: RankScope, platform: string) => scope === "all" || scope === platform;

/**
 * The highscores totals of one user for every scope. Same rules as the attributes (recompute
 * `attributeInput`): a game is played with playtime or a valid unlock, owned games include games
 * with an unlock but no library row, and `all` counts each game once however many platforms it is
 * on. `perfectGames` is the profile's Tralked (the "Tralked" board). The column keeps its name; since
 * 2026-11-06 it no longer means "Platinas e 100%" but the lists/versions completed at 100%.
 * Hours are the raw hours the platforms report (product ruling): the anti-idle caps of
 * lib/sync/playtime.ts limit the XP they pay, not the Horas jogadas ranking.
 */
export function computeRankStats(input: RankStatsInput): Record<RankScope, RankStatsValues> {
  const result = {} as Record<RankScope, RankStatsValues>;
  for (const scope of RANK_SCOPES) {
    const games = new Map<string, { playtimeMin: number; unlocked: boolean }>();
    const accOf = (gameId: string) => {
      let acc = games.get(gameId);
      if (!acc) {
        acc = { playtimeMin: 0, unlocked: false };
        games.set(gameId, acc);
      }
      return acc;
    };

    let achievements = 0;
    let rare = 0;
    let legendary = 0;
    for (const u of input.unlocks) {
      if (!inScope(scope, u.platform)) continue;
      achievements++;
      if (u.globalPct !== null && u.globalPct <= RARE_MAX_PCT) rare++;
      if (u.globalPct !== null && u.globalPct <= LEGENDARY_MAX_PCT) legendary++;
      accOf(u.gameId).unlocked = true;
    }
    for (const g of input.games) {
      if (!inScope(scope, g.platform)) continue;
      const acc = accOf(g.gameId);
      acc.playtimeMin += Math.max(0, g.playtimeMin);
    }

    const all = [...games.values()];
    const played = all.filter((g) => g.playtimeMin > 0 || g.unlocked).length;
    result[scope] = {
      playtimeMin: all.reduce((sum, g) => sum + g.playtimeMin, 0),
      achievements,
      rareAchievements: rare,
      legendaryAchievements: legendary,
      perfectGames: scope === "all" ? input.tralked.tralked : (input.tralked.tralkedByPlatform[scope] ?? 0),
      gamesOwned: all.length,
      gamesPlayed: played,
      acervo: acervoPoints(played, all.length - played),
    };
  }
  return result;
}
