import { prisma } from "@/lib/db";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { getSteam } from "@/lib/integrations";
import type { SteamPlayerAchievement } from "@/lib/integrations/steam/types";
import { syncUserGame } from "./user";

/**
 * One-off re-read of the Steam achievements earned on an unknown date (achieved=1, unlocktime 0),
 * which syncs before this change dropped: a game is read only when its playtime moves, so they
 * never came back by themselves (scripts/steam-dateless.ts).
 */

const STEAM_CONCURRENCY = 5;
/** Waits before each retry of a Steam answer 429/5xx (then the game is listed as not read). */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

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
  /** The re-read completes the game (100%): the platinum bonus is paid too. */
  completes: boolean;
  /** That bonus (0 when it does not complete). */
  platinumBonus: number;
  /** XP the missing unlocks pay, platinum bonus included. */
  xp: number;
};

export type DatelessPlan = {
  /** `private`: Steam hides the player's game details; nothing was planned. */
  status: "ok" | "private";
  games: DatelessGame[];
  /** Games Steam did not answer for (an error after the retries): left out of the plan. */
  notRead: { appId: number; name: string; error: string }[];
  /**
   * Total XP now and once the re-read is recorded. Estimate: a completion made only of dated unlocks
   * may still be held back by the speed-platinum rule (one with undated unlocks is exempt).
   */
  xpBefore: number;
  xpAfter: number;
};

export type DatelessOptions = { retryDelaysMs?: number[]; sleep?: (ms: number) => Promise<void> };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Steam's answer was a rate limit or a server error (the client says "failed with HTTP <status>"). */
const retryable = (error: unknown) => {
  const status = Number(/HTTP (\d{3})/.exec(error instanceof Error ? error.message : "")?.[1]);
  return status === 429 || status >= 500;
};

/** GetPlayerAchievements, retried with backoff on 429/5xx. */
async function readAchievements(
  steamId: string,
  appId: number,
  { retryDelaysMs = RETRY_DELAYS_MS, sleep = wait }: DatelessOptions,
): Promise<SteamPlayerAchievement[] | "private"> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getSteam().getPlayerAchievements(steamId, appId);
    } catch (error) {
      if (attempt >= retryDelaysMs.length || !retryable(error)) throw error;
      await sleep(retryDelaysMs[attempt]);
    }
  }
}

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
 * Reads the database once up front (no query per game) and writes nothing. A game Steam fails to
 * answer for is listed in `notRead`; the rest of the plan stands.
 */
export async function planDateless(userId: string, options: DatelessOptions = {}): Promise<DatelessPlan> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { steamId: true, stats: { select: { totalXp: true } } },
  });
  const xpBefore = user.stats?.totalXp ?? 0;
  const empty = (status: DatelessPlan["status"]): DatelessPlan => ({
    status,
    games: [],
    notRead: [],
    xpBefore,
    xpAfter: xpBefore,
  });
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

  const planned: DatelessGame[] = [];
  const notRead: DatelessPlan["notRead"] = [];
  let sawPrivate = false;
  await eachLimited(games, STEAM_CONCURRENCY, () => sawPrivate, async (game) => {
    let answer: SteamPlayerAchievement[] | "private";
    try {
      answer = await readAchievements(steamId, game.steamAppId!, options);
    } catch (error) {
      notRead.push({ appId: game.steamAppId!, name: game.name, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (answer === "private") {
      sawPrivate = true;
      return;
    }
    const byApiName = new Map(game.achievements.map((a) => [a.apiName, a]));
    // Only achievements the catalog knows (as the sync, which counts what Steam still lists).
    const earned = answer.filter((a) => a.achieved && byApiName.has(a.apiName));
    const missing = earned.filter((a) => !recorded.has(byApiName.get(a.apiName)!.id));
    if (missing.length === 0) return;
    const unlocksXp = missing.reduce((sum, a) => sum + xpForAchievement(byApiName.get(a.apiName)!.globalPct), 0);
    // As recordGame: complete when every achievement Steam lists is earned.
    const listed = game.achievements.filter((a) => answer.some((s) => s.apiName === a.apiName));
    const completes = earned.length >= Math.max(game.achievementCount, listed.length);
    const bonus = completes ? platinumBonus(listed.map((a) => xpForAchievement(a.globalPct))) : 0;
    planned.push({
      appId: game.steamAppId!,
      name: game.name,
      steamEarned: earned.length,
      tralkedEarned: earned.length - missing.length,
      missing: missing.length,
      undated: missing.filter((a) => a.unlockedAt === null).length,
      completes,
      platinumBonus: bonus,
      xp: unlocksXp + bonus,
    });
  });
  if (sawPrivate) return empty("private");
  const byName = <T extends { name: string; appId: number }>(a: T, b: T) => a.name.localeCompare(b.name) || a.appId - b.appId;
  planned.sort(byName);
  notRead.sort(byName);
  return {
    status: "ok",
    games: planned,
    notRead,
    xpBefore,
    xpAfter: xpBefore + planned.reduce((sum, g) => sum + g.xp, 0),
  };
}

/**
 * Records the planned games through the sync's own path (syncUserGame: same anti-fraud, ledger and
 * recompute; playtime left as stored). A game that fails is listed and the others go on. Returns
 * how many unlocks were recorded, the appids that failed, and the total XP after.
 */
export async function applyDateless(
  userId: string,
  plan: DatelessPlan,
): Promise<{ recorded: number; failed: number[]; xpAfter: number }> {
  let recorded = 0;
  const failed: number[] = [];
  for (const game of plan.games) {
    try {
      const result = await syncUserGame(userId, game.appId);
      if (result.status === "ok") recorded += result.newUnlocks.length;
      else failed.push(game.appId);
    } catch (error) {
      console.error(`steam:dateless: could not record app ${game.appId} for user ${userId}`, error);
      failed.push(game.appId);
    }
  }
  const stats = await prisma.userStats.findUnique({ where: { userId }, select: { totalXp: true } });
  return { recorded, failed, xpAfter: stats?.totalXp ?? 0 };
}
