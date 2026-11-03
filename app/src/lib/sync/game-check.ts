import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export const GAME_CHECK_INTERVAL_MS = 15_000;

const keyOf = (userId: string) => `game-check:${userId}`;

/**
 * At most one single-game Steam check per user every 15 s (the full sync keeps its own 2-minute
 * slot). The slot is a `SyncCursor` row `{ at: ms }`; the claim is one conditional update, so
 * concurrent calls cannot both win. The very first claim creates the row (a lost create race
 * means another call claimed first).
 */
export async function claimGameCheckSlot(userId: string, now: Date = new Date()): Promise<boolean> {
  const key = keyOf(userId);
  const at = now.getTime();
  const { count } = await prisma.syncCursor.updateMany({
    where: { key, value: { path: ["at"], lt: at - GAME_CHECK_INTERVAL_MS } },
    data: { value: { at } },
  });
  if (count === 1) return true;
  try {
    await prisma.syncCursor.create({ data: { key, value: { at } } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}
