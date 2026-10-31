import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient;

/**
 * The user's valid 100% completions, one per game and platform: a completion with any suspicious
 * unlock on that platform (anti-fraud pending, or confirmed fraud) does not count. Same rule as
 * the attributes (recompute `attributeInput`), so the sheet, the Troféus card and Coleção agree.
 */
export async function validCompletions(
  userId: string,
  db: Db = prisma,
): Promise<{ gameId: string; platform: string }[]> {
  const [completed, tainted] = await Promise.all([
    db.userGame.findMany({
      where: { userId, completedAt: { not: null } },
      select: { gameId: true, platform: true },
    }),
    db.userAchievement.findMany({
      where: { userId, suspicious: true },
      select: { achievement: { select: { gameId: true, platform: true } } },
    }),
  ]);
  const taintedKeys = new Set(tainted.map((t) => `${t.achievement.gameId}:${t.achievement.platform}`));
  return completed.filter((c) => !taintedKeys.has(`${c.gameId}:${c.platform}`));
}
