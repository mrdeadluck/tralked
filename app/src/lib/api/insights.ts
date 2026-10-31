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

/**
 * Distinct users with a library row for the game (one user can own it on several platforms),
 * counted in the database instead of loading one row per user.
 */
function countPlayers(gameId: string, row: Prisma.UserGameWhereInput = {}) {
  return prisma.user.count({ where: { games: { some: { gameId, ...row } } } });
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

  const [owners, played, playedRows, rarest] = await Promise.all([
    countPlayers(game.id),
    countPlayers(game.id, { playtimeMin: { gt: 0 } }),
    prisma.userGame.aggregate({ where: { gameId: game.id, playtimeMin: { gt: 0 } }, _avg: { playtimeMin: true } }),
    prisma.achievement.findMany({
      where: { gameId: game.id, hidden: false, globalPct: { not: null } },
      orderBy: [{ globalPct: "asc" }, { name: "asc" }],
      take: RAREST_COUNT,
      select: { platform: true, apiName: true, name: true, globalPct: true },
    }),
  ]);

  const average = playedRows._avg.playtimeMin;
  return {
    game: {
      slug: game.slug,
      name: game.name,
      releaseDate: game.releaseDate?.toISOString() ?? null,
      platforms: game.platforms,
      achievementCount: game.achievementCount,
      timeToBeatCompleteMin: game.timeToBeatCompleteMin,
    },
    tralked: {
      players: owners,
      avgPlaytimeMin: played >= MIN_PLAYTIME_SAMPLE && average !== null ? Math.round(average) : null,
    },
    rarest: rarest.map((a) => ({ platform: a.platform, apiName: a.apiName, name: a.name, globalPct: a.globalPct as number })),
  };
}
