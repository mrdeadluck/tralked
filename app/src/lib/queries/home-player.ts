import { cacheLife, cacheTag } from "next/cache";
import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import { levelFromXp } from "@/lib/engine/xp";
import { previousRanks, getStanding } from "@/lib/highscores/queries";
import { dailyPeriodKey } from "@/lib/progression/periods";

/**
 * "Sua partida", the home strip of a signed-in player: level and progress to the next one, the
 * game closest to 100%, today's mission, the streak and the rank. A handful of small indexed
 * reads (stats row, today's missions, one library query, the last unlock, the rank), cached per
 * player for a minute so reloading the home never queries again (Vercel Hobby + Neon free).
 */

export type HomePlayer = {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  /** Has any XP at all (an account with nothing synced yet gets the way in instead). */
  started: boolean;
  level: number;
  /** 0–100, floored: progress inside the current level. */
  levelPct: number;
  /** XP left to the next level. */
  xpToNext: number;
  closest: {
    slug: string;
    name: string;
    coverUrl: string | null;
    unlocked: number;
    total: number;
    /** 0–99, floored (100 is a completed game, never "closest"). */
    pct: number;
  } | null;
  /** The first daily mission still open today, else the last one done (all done). */
  mission: { title: string; progress: number; goal: number; rewardXp: number; done: boolean; allDone: boolean } | null;
  streak: { current: number; shields: number; activeToday: boolean };
  /** Nível board, public profiles only; null when private or unranked. */
  rank: {
    position: number;
    /** Positions gained (+) or lost (−) since the last daily snapshot; null without history. */
    delta: number | null;
    /** The player right above passed this one since the snapshot. */
    passedBy: string | null;
    /** The player right above (null at #1). */
    above: string | null;
  } | null;
  profilePublic: boolean;
};

type ClosestRow = { slug: string; name: string; coverUrl: string | null; unlocked: number; total: number };

/** The library game with the highest share of achievements that is not 100% on any platform. */
async function closestGame(userId: string): Promise<ClosestRow | null> {
  const [row] = await prisma.$queryRaw<ClosestRow[]>`
    WITH lib AS (
      SELECT ug."gameId", ug."unlockedCount" AS unlocked,
        CASE WHEN ug.platform = 'steam' THEN g."achievementCount"
          ELSE (SELECT count(*)::int FROM "Achievement" a WHERE a."gameId" = ug."gameId" AND a.platform = ug.platform)
        END AS total
      FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
      WHERE ug."userId" = ${userId} AND ug."unlockedCount" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "UserGame" done
          WHERE done."userId" = ug."userId" AND done."gameId" = ug."gameId" AND done."completedAt" IS NOT NULL
        )
    )
    SELECT g.slug, g.name, g."coverUrl", lib.unlocked, lib.total
    FROM lib JOIN "Game" g ON g.id = lib."gameId"
    WHERE lib.total > lib.unlocked
    ORDER BY lib.unlocked::float / lib.total DESC, lib.total - lib.unlocked ASC, g.name ASC
    LIMIT 1`;
  return row ?? null;
}

export async function getHomePlayer(userId: string, now = new Date()): Promise<HomePlayer | null> {
  const today = dailyPeriodKey(now);
  const [user, missions, closest, lastUnlock, standing] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        handle: true,
        displayName: true,
        avatarUrl: true,
        profilePublic: true,
        stats: { select: { totalXp: true, streakCurrent: true, shields: true } },
      },
    }),
    prisma.mission.findMany({
      where: { userId, kind: "daily", periodKey: today },
      orderBy: { id: "asc" },
      select: { title: true, progress: true, rewardXp: true, completedAt: true, condition: true },
    }),
    closestGame(userId),
    prisma.userAchievement.findFirst({
      where: { userId, suspicious: false },
      orderBy: { unlockedAt: "desc" },
      select: { unlockedAt: true },
    }),
    getStanding(userId, { metric: "nivel" }, now),
  ]);
  if (!user) return null;

  const totalXp = user.stats?.totalXp ?? 0;
  const progress = levelFromXp(totalXp);

  const views = missions.map((m) => {
    const goal = (m.condition as { minCount?: number } | null)?.minCount || 1;
    return { title: m.title, progress: Math.min(m.progress, goal), goal, rewardXp: m.rewardXp, done: m.completedAt !== null || m.progress >= goal };
  });
  const open = views.find((m) => !m.done);
  const mission = open
    ? { ...open, allDone: false }
    : views.length > 0
      ? { ...views[views.length - 1], allDone: true }
      : null;

  let rank: HomePlayer["rank"] = null;
  if (standing) {
    const { row, above } = standing;
    const delta = row.previousRank === null ? null : row.previousRank - row.rank;
    let passedBy: string | null = null;
    // Dropped since the snapshot: say who did it when the player right above was behind before.
    if (above && delta !== null && delta < 0 && row.previousRank !== null) {
      const history = await previousRanks("nivel", [above.userId], today);
      const before = history.ranks.get(above.userId);
      if (before === undefined || before > row.previousRank) passedBy = above.handle;
    }
    rank = { position: row.rank, delta, passedBy, above: above?.handle ?? null };
  }

  return {
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    started: totalXp > 0,
    level: progress.level,
    levelPct: Math.min(99, Math.floor(progress.fraction * 100)),
    xpToNext: Math.max(0, progress.next - progress.current),
    closest: closest
      ? { ...closest, pct: Math.min(99, Math.floor((closest.unlocked / closest.total) * 100)) }
      : null,
    mission,
    streak: {
      current: user.stats?.streakCurrent ?? 0,
      shields: user.stats?.shields ?? 0,
      activeToday: lastUnlock !== null && toLocalDay(lastUnlock.unlockedAt) === today,
    },
    rank,
    profilePublic: user.profilePublic,
  };
}

/** Cache tag of one player's home strip (sync and missions can refresh it early). */
export const homePlayerTag = (userId: string) => `home-player:${userId}`;

/**
 * The strip's data, cached per player and day for a minute (`day` keys the entry, so the daily
 * mission turns over at midnight even inside the cache life).
 */
export async function getHomePlayerCached(userId: string, day: string): Promise<HomePlayer | null> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  cacheTag(homePlayerTag(userId));
  void day;
  return getHomePlayer(userId);
}
