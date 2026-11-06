import { prisma } from "@/lib/db";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { getSteam } from "@/lib/integrations";
import { syncUserGame } from "./user";

/**
 * One-off re-read of the Steam achievements earned on an unknown date (achieved=1, unlocktime 0),
 * which syncs before 2026-11-09 dropped: a game is read only when its playtime moves, so they
 * never came back by themselves (scripts/steam-dateless.ts).
 */

const STEAM_CONCURRENCY = 5;

export type DatelessGame = {
  appId: number;
  name: string;
  /** Earned on Steam (dated or not), among the achievements the catalog knows. */
  steamEarned: number;
  /** Recorded in Tralked. */
  tralkedEarned: number;
  /** Earned on Steam and not recorded: what the re-read adds. */
  missing: number;
  /** How many of `missing` Steam gives without a date. */
  undated: number;
  /** XP they pay, plus the platinum bonus when they complete the game (unless flagged). */
  xp: number;
};

export type DatelessPlan = {
  /** `private`: Steam hides the player's game details; nothing was planned. */
  status: "ok" | "private";
  games: DatelessGame[];
  /** Total XP now and once the re-read is recorded (estimate: the anti-fraud rules may hold some back). */
  xpBefore: number;
  xpAfter: number;
};

/** Runs `worker` over `items`, at most `limit` at a time; stops taking items once `stop()` is true. */
async function eachLimited<T>(items: T[], limit: number, stop: () => boolean, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !stop()) await worker(items[next++]);
    }),
  );
}

/**
 * Asks Steam for the player's achievements of every Steam game of theirs not complete in Tralked
 * that has achievements, and lists those where Steam has more earned than Tralked recorded.
 * Reads the database once up front (no query per game) and writes nothing.
 */
export async function planDateless(userId: string): Promise<DatelessPlan> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { steamId: true, stats: { select: { totalXp: true } } },
  });
  const xpBefore = user.stats?.totalXp ?? 0;
  const empty = (status: DatelessPlan["status"]): DatelessPlan => ({ status, games: [], xpBefore, xpAfter: xpBefore });
  if (!user.steamId) return empty("ok");
  const steamId = user.steamId;

  const owned = await prisma.userGame.findMany({
    where: { userId, platform: "steam", completedAt: null, game: { steamAppId: { not: null }, achievementCount: { gt: 0 } } },
    select: {
      game: {
        select: {
          steamAppId: true,
          name: true,
          achievementCount: true,
          achievements: { where: { platform: "steam" }, select: { id: true, apiName: true, globalPct: true } },
        },
      },
    },
  });
  const games = owned.map((o) => o.game);
  const recorded = new Set(
    (
      await prisma.userAchievement.findMany({
        where: { userId, achievement: { platform: "steam" } },
        select: { achievementId: true },
      })
    ).map((u) => u.achievementId),
  );

  const steam = getSteam();
  const planned: DatelessGame[] = [];
  let sawPrivate = false;
  await eachLimited(games, STEAM_CONCURRENCY, () => sawPrivate, async (game) => {
    const answer = await steam.getPlayerAchievements(steamId, game.steamAppId!);
    if (answer === "private") {
      sawPrivate = true;
      return;
    }
    const byApiName = new Map(game.achievements.map((a) => [a.apiName, a]));
    // Only achievements the catalog knows (as the sync, which counts what Steam still lists).
    const earned = answer.filter((a) => a.achieved && byApiName.has(a.apiName));
    const missing = earned.filter((a) => !recorded.has(byApiName.get(a.apiName)!.id));
    if (missing.length === 0) return;
    const tralkedEarned = earned.length - missing.length;
    let xp = missing.reduce((sum, a) => sum + xpForAchievement(byApiName.get(a.apiName)!.globalPct), 0);
    // As recordGame: complete when every achievement Steam lists is earned.
    const listed = game.achievements.filter((a) => answer.some((s) => s.apiName === a.apiName));
    if (earned.length >= Math.max(game.achievementCount, listed.length)) {
      xp += platinumBonus(listed.map((a) => xpForAchievement(a.globalPct)));
    }
    planned.push({
      appId: game.steamAppId!,
      name: game.name,
      steamEarned: earned.length,
      tralkedEarned,
      missing: missing.length,
      undated: missing.filter((a) => a.unlockedAt === null).length,
      xp,
    });
  });
  if (sawPrivate) return empty("private");
  planned.sort((a, b) => a.name.localeCompare(b.name) || a.appId - b.appId);
  return { status: "ok", games: planned, xpBefore, xpAfter: xpBefore + planned.reduce((sum, g) => sum + g.xp, 0) };
}

/**
 * Records the planned games through the sync's own path (syncUserGame: same anti-fraud, ledger and
 * recompute; playtime left as stored). Returns how many unlocks were recorded, the appids that
 * failed, and the total XP after.
 */
export async function applyDateless(
  userId: string,
  plan: DatelessPlan,
): Promise<{ recorded: number; failed: number[]; xpAfter: number }> {
  let recorded = 0;
  const failed: number[] = [];
  for (const game of plan.games) {
    const result = await syncUserGame(userId, game.appId);
    if (result.status === "ok") recorded += result.newUnlocks.length;
    else failed.push(game.appId);
  }
  const stats = await prisma.userStats.findUnique({ where: { userId }, select: { totalXp: true } });
  return { recorded, failed, xpAfter: stats?.totalXp ?? 0 };
}
