import { prisma } from "@/lib/db";
import { countedUnlocks } from "@/lib/trophies/counted";
import { computeRankStats, RANK_SCOPES, type RankScope, type RankStatsValues } from "./stats";

type ValidUnlock = {
  unlockedAt: Date;
  achievement: {
    gameId: string;
    platform: string;
    apiName: string;
    globalPct: number | null;
    list: { platform: string; console: string | null; externalId: string } | null;
  };
};

/**
 * One user's highscores totals. `unlocks` are the valid unlocks (the recompute already loaded
 * them); the library and the tainted games are read here. Unlocks are counted once per console
 * (countedUnlocks: a PSN trophy earned in two regional lists of one console counts once).
 */
export async function loadRankStats(
  userId: string,
  unlocks: ValidUnlock[],
): Promise<Record<RankScope, RankStatsValues>> {
  const [games, tainted] = await Promise.all([
    prisma.userGame.findMany({
      where: { userId },
      select: { gameId: true, platform: true, playtimeMin: true, completedAt: true },
    }),
    prisma.userAchievement.findMany({
      where: { userId, suspicious: true },
      select: { achievement: { select: { gameId: true, platform: true } } },
    }),
  ]);
  return computeRankStats({
    games,
    unlocks: countedUnlocks(unlocks).map((u) => u.achievement),
    taintedKeys: new Set(tainted.map((t) => `${t.achievement.gameId}:${t.achievement.platform}`)),
  });
}

/**
 * The writes that bring one user's `UserRankStats` up to date, for the recompute transaction.
 * Every scope is written (zeros included), so an unlinked platform drops out of its ranking at
 * the next recompute.
 */
export async function rankStatsWrites(userId: string, unlocks: ValidUnlock[]) {
  return upserts(userId, await loadRankStats(userId, unlocks));
}

const upserts = (userId: string, stats: Record<RankScope, RankStatsValues>) =>
  RANK_SCOPES.map((scope) =>
    prisma.userRankStats.upsert({
      where: { userId_scope: { userId, scope } },
      create: { userId, scope, ...stats[scope] },
      update: stats[scope],
    }),
  );

/**
 * Rewrites one user's `UserRankStats` alone (no missions, XP or attributes): the backfill script
 * for databases from before the highscores tables. Returns the `all` totals (written or, in a dry
 * run, that would be written).
 */
export async function refreshRankStats(userId: string, { dryRun = false } = {}): Promise<RankStatsValues> {
  const unlocks = await prisma.userAchievement.findMany({
    where: { userId, suspicious: false },
    select: {
      unlockedAt: true,
      achievement: {
        select: {
          gameId: true,
          platform: true,
          apiName: true,
          globalPct: true,
          list: { select: { platform: true, console: true, externalId: true } },
        },
      },
    },
  });
  const stats = await loadRankStats(userId, unlocks);
  if (!dryRun) await prisma.$transaction(upserts(userId, stats));
  return stats.all;
}
