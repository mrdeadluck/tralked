import type { Achievement, Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ensureTrophyList } from "./lists";

// Tests only: every Achievement belongs to a TrophyList (listId is required), so fixtures that
// only need "the game's achievements" put them on the game's list of their platform.

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * The game's list on a platform, created when missing, keyed as the syncs key it: Steam its appid
 * (`game:<gameId>` for a game without one), the other platforms `test:<gameId>`.
 */
export async function testListId(gameId: string, platform = "steam", db: Db = prisma): Promise<string> {
  const game = await db.game.findUniqueOrThrow({ where: { id: gameId }, select: { name: true, steamAppId: true } });
  const externalId = platform === "steam" && game.steamAppId !== null ? String(game.steamAppId) : `${platform === "steam" ? "game" : "test"}:${gameId}`;
  const stored = await db.trophyList.findUnique({ where: { platform_externalId: { platform, externalId } }, select: { id: true } });
  if (stored) return stored.id;
  const list = await ensureTrophyList(db, {
    gameId,
    platform,
    externalId,
    console: platform === "steam" ? "PC" : null,
    name: game.name,
    trophyCount: 0,
  });
  return list.id;
}

export type TestAchievement = Omit<Prisma.AchievementUncheckedCreateInput, "gameId" | "listId">;

/** Creates these rows of the game, in order, each on the game's list of its platform (default Steam). */
export async function createAchievements(gameId: string, rows: TestAchievement[], db: Db = prisma): Promise<Achievement[]> {
  const lists = new Map<string, string>();
  const out: Achievement[] = [];
  for (const row of rows) {
    const platform = row.platform ?? "steam";
    if (!lists.has(platform)) lists.set(platform, await testListId(gameId, platform, db));
    out.push(await db.achievement.create({ data: { ...row, gameId, platform, listId: lists.get(platform)! } }));
  }
  return out;
}
