import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { slugSchema } from "@/lib/content/guide-schema";

/**
 * What the robot may know about Tralked's players of a game: aggregates only. No user ids, no
 * handles; the average playtime is hidden below MIN_PLAYTIME_SAMPLE players so it never
 * describes one or two identifiable people.
 */

const MIN_PLAYTIME_SAMPLE = 3;
const RAREST_COUNT = 5;
const DOSSIER_ACHIEVEMENT_CAP = 500;

/**
 * Distinct users with a library row for the game (one user can own it on several platforms),
 * counted in the database instead of loading one row per user.
 */
function countPlayers(gameId: string, row: Prisma.UserGameWhereInput = {}) {
  return prisma.user.count({ where: { games: { some: { gameId, ...row } } } });
}

/** Players and average playtime of a game; the average is hidden below MIN_PLAYTIME_SAMPLE players. */
async function playerStats(gameId: string): Promise<{ players: number; avgPlaytimeMin: number | null }> {
  const [players, played, rows] = await Promise.all([
    countPlayers(gameId),
    countPlayers(gameId, { playtimeMin: { gt: 0 } }),
    prisma.userGame.aggregate({ where: { gameId, playtimeMin: { gt: 0 } }, _avg: { playtimeMin: true } }),
  ]);
  const average = rows._avg.playtimeMin;
  return { players, avgPlaytimeMin: played >= MIN_PLAYTIME_SAMPLE && average !== null ? Math.round(average) : null };
}

export type GameInsights = {
  game: {
    slug: string;
    name: string;
    releaseDate: string | null;
    platforms: string[];
    achievementCount: number;
    timeToBeatCompleteMin: number | null;
  };
  tralked: { players: number; avgPlaytimeMin: number | null };
  rarest: { platform: string; apiName: string; name: string; globalPct: number }[];
};

/** Insights of the game, or null when the slug is malformed or unknown. */
export async function gameInsights(slug: string): Promise<GameInsights | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const game = await prisma.game.findUnique({
    where: { slug: parsed.data },
    select: {
      id: true,
      slug: true,
      name: true,
      releaseDate: true,
      platforms: true,
      achievementCount: true,
      timeToBeatCompleteMin: true,
    },
  });
  if (!game) return null;

  const [tralked, rarest] = await Promise.all([
    playerStats(game.id),
    prisma.achievement.findMany({
      where: { gameId: game.id, hidden: false, globalPct: { not: null } },
      orderBy: [{ globalPct: "asc" }, { name: "asc" }],
      take: RAREST_COUNT,
      select: { platform: true, apiName: true, name: true, globalPct: true },
    }),
  ]);

  return {
    game: {
      slug: game.slug,
      name: game.name,
      releaseDate: game.releaseDate?.toISOString() ?? null,
      platforms: game.platforms,
      achievementCount: game.achievementCount,
      timeToBeatCompleteMin: game.timeToBeatCompleteMin,
    },
    tralked,
    rarest: rarest.map((a) => ({ platform: a.platform, apiName: a.apiName, name: a.name, globalPct: a.globalPct as number })),
  };
}

export type GameDossier = {
  game: {
    slug: string;
    name: string;
    steamAppId: number | null;
    summary: string | null;
    developer: string | null;
    publisher: string | null;
    releaseDate: string | null;
    platforms: string[];
    criticScore: number | null;
    timeToBeatCompleteMin: number | null;
    achievementCount: number;
  };
  tralked: { players: number; avgPlaytimeMin: number | null; completedPlayers: number };
  /** Every visible achievement, rarest first, unknown rarity last (at most 500). */
  achievements: { platform: string; apiName: string; name: string; description: string | null; globalPct: number | null }[];
};

/** Full dossier of the game for evergreen pieces, or null when the slug is malformed or unknown. */
export async function gameDossier(slug: string): Promise<GameDossier | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const game = await prisma.game.findUnique({
    where: { slug: parsed.data },
    select: {
      id: true,
      slug: true,
      name: true,
      steamAppId: true,
      summary: true,
      developer: true,
      publisher: true,
      releaseDate: true,
      platforms: true,
      criticScore: true,
      timeToBeatCompleteMin: true,
      achievementCount: true,
    },
  });
  if (!game) return null;

  const [stats, completedPlayers, achievements] = await Promise.all([
    playerStats(game.id),
    prisma.user.count({ where: { games: { some: { gameId: game.id, completedAt: { not: null } } } } }),
    prisma.achievement.findMany({
      where: { gameId: game.id, hidden: false },
      orderBy: [{ globalPct: { sort: "asc", nulls: "last" } }, { name: "asc" }, { apiName: "asc" }],
      take: DOSSIER_ACHIEVEMENT_CAP,
      select: { platform: true, apiName: true, name: true, description: true, globalPct: true },
    }),
  ]);

  return {
    game: {
      slug: game.slug,
      name: game.name,
      steamAppId: game.steamAppId,
      summary: game.summary,
      developer: game.developer,
      publisher: game.publisher,
      releaseDate: game.releaseDate?.toISOString() ?? null,
      platforms: game.platforms,
      criticScore: game.criticScore,
      timeToBeatCompleteMin: game.timeToBeatCompleteMin,
      achievementCount: game.achievementCount,
    },
    tralked: { ...stats, completedPlayers },
    achievements,
  };
}
