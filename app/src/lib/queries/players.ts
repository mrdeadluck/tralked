import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { skillNeed } from "@/lib/engine/skills";
import { toLocalDay } from "@/lib/engine/streak";
import { SKILLS, type RarityTier, type SkillId } from "@/lib/engine/types";
import { levelFromXp, rarityTier, xpForAchievement } from "@/lib/engine/xp";
import type { MissionCondition } from "@/lib/engine/missions";
import { dailyPeriodKey, weeklyPeriodKey } from "@/lib/progression/periods";

/** Any Prisma client; tests pass a transaction client to see uncommitted fixtures. */
export type Db = Prisma.TransactionClient;

const DAY_MS = 86_400_000;
const TIME_ZONE = "America/Sao_Paulo";
const WEEK_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];

export type HighscoreSkill = SkillId | "geral";

export function isHighscoreSkill(value: string): value is HighscoreSkill {
  return value === "geral" || SKILLS.some((s) => s.id === value);
}

export type HighscoreRow = {
  rank: number;
  handle: string;
  vocation: string;
  level: number;
};

export type CharacterSkill = {
  id: SkillId;
  name: string;
  level: number;
  points: number;
  need: number;
};

export type CharacterMission = {
  id: string;
  kind: "daily" | "weekly";
  title: string;
  progress: number;
  goal: number;
  rewardXp: number;
  done: boolean;
};

export type CharacterAchievement = {
  achievementName: string;
  gameName: string;
  gameSlug: string;
  globalPct: number | null;
  rarity: RarityTier;
  xp: number;
  unlockedAt: Date;
};

export type CharacterAlmostGame = {
  slug: string;
  name: string;
  coverUrl: string | null;
  unlocked: number;
  total: number;
  percent: number;
  skills: string[];
  hasGuide: boolean;
};

export type StreakDay = { day: string; letter: string; active: boolean; today: boolean };

export type Character = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  profilePublic: boolean;
  lastSyncedAt: Date | null;
  level: number;
  totalXp: number;
  /** XP earned inside the current level, and the XP the level spans. */
  xpCurrent: number;
  xpNext: number;
  vocation: string;
  stats: {
    achievements: number;
    perfectGames: number;
    legendary: number;
    /** Rank among public profiles; null when the profile is private. */
    rank: number | null;
  };
  streak: { current: number; best: number; shields: number; week: StreakDay[] };
  skills: CharacterSkill[];
  missions: CharacterMission[];
  recent: CharacterAchievement[];
  almostThere: CharacterAlmostGame[];
};

// ---------- Time helpers (America/Sao_Paulo) ----------

const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Whole hours left until the next local midnight (the daily mission reset), at least 1. */
export function hoursUntilDailyReset(now: Date): number {
  const parts = clockFormatter.formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const elapsed = get("hour") * 3600 + get("minute") * 60 + get("second");
  return Math.max(1, Math.ceil((86_400 - elapsed) / 3600));
}


function lastSevenDays(now: Date, activeDays: Set<string>): StreakDay[] {
  const today = toLocalDay(now);
  const days: StreakDay[] = [];
  for (let back = 6; back >= 0; back--) {
    const day = toLocalDay(new Date(now.getTime() - back * DAY_MS));
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    days.push({
      day,
      letter: WEEK_LETTERS[weekday],
      active: activeDays.has(day),
      today: day === today,
    });
  }
  return days;
}

// ---------- Highscores ----------

/** A skill counts for ranking only once trained (level above 1 or any points). */
const TRAINED = { OR: [{ level: { gt: 1 } }, { points: { gt: 0 } }] };

export async function getHighscores(
  skill: HighscoreSkill,
  limit = 50,
  db: Db = prisma,
): Promise<HighscoreRow[]> {
  if (skill === "geral") {
    const rows = await db.userStats.findMany({
      where: { user: { profilePublic: true } },
      orderBy: [{ level: "desc" }, { totalXp: "desc" }, { user: { handle: "asc" } }],
      take: limit,
      select: { level: true, vocation: true, user: { select: { handle: true } } },
    });
    return rows.map((r, i) => ({
      rank: i + 1,
      handle: r.user.handle,
      vocation: r.vocation,
      level: r.level,
    }));
  }

  const rows = await db.skillProgress.findMany({
    where: { skill, user: { profilePublic: true }, ...TRAINED },
    orderBy: [{ level: "desc" }, { points: "desc" }, { user: { handle: "asc" } }],
    take: limit,
    select: {
      level: true,
      user: { select: { handle: true, stats: { select: { vocation: true } } } },
    },
  });
  return rows.map((r, i) => ({
    rank: i + 1,
    handle: r.user.handle,
    vocation: r.user.stats?.vocation ?? "Recruta",
    level: r.level,
  }));
}

/** Real rank (among public profiles, same ordering as `getHighscores`) of a public user; null if private or unranked. */
export async function getUserRank(
  userId: string,
  skill: HighscoreSkill,
  db: Db = prisma,
): Promise<HighscoreRow | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { handle: true, profilePublic: true, stats: true },
  });
  if (!user?.profilePublic) return null;

  if (skill === "geral") {
    if (!user.stats) return null;
    const { level, totalXp } = user.stats;
    const ahead = await db.userStats.count({
      where: {
        user: { profilePublic: true },
        OR: [
          { level: { gt: level } },
          { level, totalXp: { gt: totalXp } },
          { level, totalXp, user: { handle: { lt: user.handle } } },
        ],
      },
    });
    return { rank: ahead + 1, handle: user.handle, vocation: user.stats.vocation, level };
  }

  const progress = await db.skillProgress.findFirst({
    where: { userId, skill, ...TRAINED },
  });
  if (!progress) return null;
  const { level, points } = progress;
  const ahead = await db.skillProgress.count({
    where: {
      skill,
      user: { profilePublic: true },
      ...TRAINED,
      OR: [
        { level: { gt: level } },
        { level, points: { gt: points } },
        { level, points, user: { handle: { lt: user.handle } } },
      ],
    },
  });
  return {
    rank: ahead + 1,
    handle: user.handle,
    vocation: user.stats?.vocation ?? "Recruta",
    level,
  };
}

// ---------- Character ----------

export type PlayerHeader = {
  id: string;
  handle: string;
  displayName: string;
  profilePublic: boolean;
};

/** Lightweight lookup used to decide visibility before loading the full sheet. Case-insensitive. */
export async function getPlayerHeader(handle: string): Promise<PlayerHeader | null> {
  return prisma.user.findFirst({
    where: { handle: { equals: handle, mode: "insensitive" } },
    select: { id: true, handle: true, displayName: true, profilePublic: true },
  });
}

export async function getCharacter(
  handle: string,
  now = new Date(),
  db: Db = prisma,
): Promise<Character | null> {
  const user = await db.user.findFirst({
    where: { handle: { equals: handle, mode: "insensitive" } },
    include: { stats: true, skills: true },
  });
  if (!user) return null;

  const totalXp = user.stats?.totalXp ?? 0;
  const progress = levelFromXp(totalXp);

  const [
    unlockedAgg,
    perfectGames,
    legendary,
    rankRow,
    missions,
    recent,
    recentDays,
    libraryRows,
  ] = await Promise.all([
    // Plan 1 profile counts are Steam-only (other platforms' libraries come with Plan 2 views).
    db.userGame.aggregate({
      where: { userId: user.id, platform: "steam" },
      _sum: { unlockedCount: true },
    }),
    db.userGame.count({ where: { userId: user.id, platform: "steam", completedAt: { not: null } } }),
    db.userAchievement.count({
      where: {
        userId: user.id,
        suspicious: false,
        achievement: { platform: "steam", globalPct: { lte: 3 } },
      },
    }),
    user.profilePublic ? getUserRank(user.id, "geral", db) : Promise.resolve(null),
    db.mission.findMany({
      where: {
        userId: user.id,
        OR: [
          { kind: "daily", periodKey: dailyPeriodKey(now) },
          { kind: "weekly", periodKey: weeklyPeriodKey(now) },
        ],
      },
      orderBy: [{ kind: "asc" }, { title: "asc" }],
    }),
    db.userAchievement.findMany({
      where: { userId: user.id, suspicious: false },
      orderBy: { unlockedAt: "desc" },
      take: 6,
      include: {
        achievement: { include: { game: { select: { name: true, slug: true } } } },
      },
    }),
    db.userAchievement.findMany({
      where: {
        userId: user.id,
        suspicious: false,
        unlockedAt: { gte: new Date(now.getTime() - 8 * DAY_MS) },
      },
      select: { unlockedAt: true },
    }),
    db.userGame.findMany({
      where: { userId: user.id, platform: "steam", unlockedCount: { gt: 0 }, completedAt: null },
      include: {
        game: {
          select: {
            slug: true,
            name: true,
            coverUrl: true,
            achievementCount: true,
            skills: { select: { skill: true } },
            guide: { select: { status: true } },
          },
        },
      },
    }),
  ]);

  const byId = new Map(user.skills.map((s) => [s.skill, s]));
  const skillRows: CharacterSkill[] = SKILLS.map((s) => {
    const row = byId.get(s.id);
    const level = row?.level ?? 1;
    return { id: s.id, name: s.name, level, points: row?.points ?? 0, need: skillNeed(level) };
  });
  const earnable = skillRows
    .filter((s) => s.id !== "sabio")
    .sort((a, b) => b.level - a.level || b.points - a.points);
  const sabio = skillRows.filter((s) => s.id === "sabio");

  const skillName = new Map(SKILLS.map((s) => [s.id as string, s.name]));
  const almostThere = libraryRows
    .filter((row) => row.game.achievementCount > 0)
    .map((row) => ({
      slug: row.game.slug,
      name: row.game.name,
      coverUrl: row.game.coverUrl,
      unlocked: row.unlockedCount,
      total: row.game.achievementCount,
      percent: Math.floor((row.unlockedCount / row.game.achievementCount) * 100),
      skills: row.game.skills.map((s) => skillName.get(s.skill) ?? s.skill),
      hasGuide: row.game.guide?.status === "published",
    }))
    .filter((g) => g.unlocked < g.total && g.unlocked / g.total >= 0.7)
    .sort((a, b) => b.unlocked / b.total - a.unlocked / a.total)
    .slice(0, 6);

  return {
    userId: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    profilePublic: user.profilePublic,
    lastSyncedAt: user.lastSyncedAt,
    level: user.stats?.level ?? progress.level,
    totalXp,
    xpCurrent: progress.current,
    xpNext: progress.next,
    vocation: user.stats?.vocation ?? "Recruta",
    stats: {
      achievements: unlockedAgg._sum.unlockedCount ?? 0,
      perfectGames,
      legendary,
      rank: rankRow?.rank ?? null,
    },
    streak: {
      current: user.stats?.streakCurrent ?? 0,
      best: user.stats?.streakBest ?? 0,
      shields: user.stats?.shields ?? 0,
      week: lastSevenDays(now, new Set(recentDays.map((r) => toLocalDay(r.unlockedAt)))),
    },
    skills: [...earnable, ...sabio],
    missions: missions.map((m) => {
      const goal = (m.condition as MissionCondition).minCount;
      return {
        id: m.id,
        kind: m.kind as "daily" | "weekly",
        title: m.title,
        progress: m.progress,
        goal,
        rewardXp: m.rewardXp,
        done: m.completedAt !== null || m.progress >= goal,
      };
    }),
    recent: recent.map((r) => ({
      achievementName: r.achievement.name,
      gameName: r.achievement.game.name,
      gameSlug: r.achievement.game.slug,
      globalPct: r.achievement.globalPct,
      rarity: rarityTier(r.achievement.globalPct ?? 50),
      xp: xpForAchievement(r.achievement.globalPct),
      unlockedAt: r.unlockedAt,
    })),
    almostThere,
  };
}
