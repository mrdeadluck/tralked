import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { skillNeed } from "@/lib/engine/skills";
import { toLocalDay } from "@/lib/engine/streak";
import { SKILLS, type RarityTier, type SkillId } from "@/lib/engine/types";
import { levelFromXp, rarityTier, xpForAchievement } from "@/lib/engine/xp";
import type { MissionCondition } from "@/lib/engine/missions";
import { rarityCounts } from "@/lib/character/counts";
import { genreName, primaryGenre } from "@/lib/engine/genres";
import { achievementTotal } from "@/lib/games/achievement-total";
import type { ArtAsset } from "@/lib/art/frame";
import { GAME_ART_SELECT, gameArtUrls } from "./game-art";
import { getRank } from "@/lib/highscores/queries";
import { validCompletions } from "@/lib/progression/completions";
import { dailyPeriodKey, weeklyPeriodKey } from "@/lib/progression/periods";

/** Any Prisma client; tests pass a transaction client to see uncommitted fixtures. */
export type Db = Prisma.TransactionClient;

const DAY_MS = 86_400_000;
const TIME_ZONE = "America/Sao_Paulo";
const WEEK_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];

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
  /** Cover fallbacks (lib/case-art): Steam's portrait art, then the hero shown whole. */
  steamAppId: number | null;
  heroUrl: string | null;
  /** Every image by kind and shape (lib/art/frame), for the card's 16:10 box. */
  art: ArtAsset[];
  unlocked: number;
  total: number;
  percent: number;
  /** The game's genre (lib/engine/genres `primaryGenre`), at most one. */
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
  /** All platforms, valid (non-suspicious) unlocks only, like the Troféus card. */
  stats: {
    achievements: number;
    /** Suspicious unlocks still waiting for review ("+N em análise"); confirmed fraud is left out. */
    pendingReview: number;
    /** Distinct games with a valid 100% on any platform. */
    perfectGames: number;
    /** Valid unlocks of rarity "lendária" (≤ 3%), as the statistics page (`rarityCounts`). */
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

  // Every platform counts, and only valid unlocks (as the Troféus card and the attributes):
  // suspicious unlocks waiting for review show as "+N em análise"; confirmed fraud never shows.
  const [
    achievements,
    pendingReview,
    completions,
    rarity,
    rankRow,
    missions,
    recent,
    recentDays,
    libraryRows,
    validByGame,
  ] = await Promise.all([
    db.userAchievement.count({ where: { userId: user.id, suspicious: false } }),
    db.userAchievement.count({ where: { userId: user.id, suspicious: true, fraudReview: null } }),
    validCompletions(user.id, db),
    // Same functions as the statistics page and the Troféus card (lib/character/counts).
    rarityCounts(user.id, db),
    user.profilePublic ? getRank(user.id, { metric: "nivel" }, db) : Promise.resolve(null),
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
      where: { userId: user.id, unlockedCount: { gt: 0 } },
      select: {
        platform: true,
        game: {
          select: {
            id: true,
            slug: true,
            name: true,
            ...GAME_ART_SELECT,
            achievementCount: true,
            skills: { select: { skill: true } },
            guide: { select: { status: true } },
          },
        },
      },
    }),
    // Valid unlocks and catalog size per game and platform of the library ("Quase lá").
    db.$queryRaw<{ gameId: string; platform: string; unlocked: number; total: number }[]>`
      SELECT ug."gameId", ug.platform,
        (SELECT count(*)::int FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
          WHERE ua."userId" = ug."userId" AND ua.suspicious = false
            AND a."gameId" = ug."gameId" AND a.platform = ug.platform) AS unlocked,
        (SELECT count(*)::int FROM "Achievement" a
          WHERE a."gameId" = ug."gameId" AND a.platform = ug.platform) AS total
      FROM "UserGame" ug
      WHERE ug."userId" = ${user.id} AND ug."unlockedCount" > 0`,
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

  // Distinct games with a valid 100% on any platform (one game on Steam and PSN is one game).
  const perfect = new Set(completions.map((c) => c.gameId));
  const counts = new Map(validByGame.map((r) => [`${r.gameId}:${r.platform}`, r]));
  // "Quase lá": the closest platform of each game not yet 100% anywhere, from valid unlocks.
  // Steam's size is the game's upstream count; other platforms count their catalog rows.
  const closest = new Map<string, CharacterAlmostGame>();
  for (const row of libraryRows) {
    if (perfect.has(row.game.id)) continue;
    const count = counts.get(`${row.game.id}:${row.platform}`);
    const total = achievementTotal(row.platform, row.game.achievementCount, count?.total ?? 0);
    const unlocked = count?.unlocked ?? 0;
    if (total <= 0 || unlocked >= total || unlocked / total < 0.7) continue;
    const best = closest.get(row.game.slug);
    if (best && best.unlocked / best.total >= unlocked / total) continue;
    closest.set(row.game.slug, {
      slug: row.game.slug,
      name: row.game.name,
      ...gameArtUrls(row.game),
      unlocked,
      total,
      percent: Math.floor((unlocked / total) * 100),
      skills: [primaryGenre(row.game.skills.map((s) => s.skill))].flatMap((g) => (g ? [genreName(g)] : [])),
      hasGuide: row.game.guide?.status === "published",
    });
  }
  const almostThere = [...closest.values()]
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
      achievements,
      pendingReview,
      perfectGames: perfect.size,
      legendary: rarity.lendaria,
      rank: rankRow,
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
