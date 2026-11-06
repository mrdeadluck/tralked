import { platinumTallyOf } from "@/lib/character/counts";
import { prisma } from "@/lib/db";
import { computeRankStats, RANK_SCOPES, type RankScope, type RankStatsValues } from "./stats";

type ValidUnlock = { achievement: { gameId: string; platform: string; globalPct: number | null } };

/**
 * One user's highscores totals. `unlocks` are the valid unlocks (the recompute already loaded
 * them); the library and the platinums (the profile's, one per list) are read here. Every list
 * counts (a PSN trophy earned in two regional lists is two).
 */
export async function loadRankStats(
  userId: string,
  unlocks: ValidUnlock[],
): Promise<Record<RankScope, RankStatsValues>> {
  const [games, platinums] = await Promise.all([
    prisma.userGame.findMany({ where: { userId }, select: { gameId: true, platform: true, playtimeMin: true } }),
    // Read now: the per-request memo could hold a value from before this recompute's changes.
    platinumTallyOf(userId),
  ]);
  return computeRankStats({ games, unlocks: unlocks.map((u) => u.achievement), platinums });
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
    select: { achievement: { select: { gameId: true, platform: true, globalPct: true } } },
  });
  const stats = await loadRankStats(userId, unlocks);
  if (!dryRun) await prisma.$transaction(upserts(userId, stats));
  return stats.all;
}
