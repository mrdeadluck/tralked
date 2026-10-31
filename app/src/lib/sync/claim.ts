import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export const MIN_SYNC_INTERVAL_MS = 2 * 60_000;

/**
 * Atomically claims the right to start a manual sync: succeeds only if the user's last sync
 * attempt (`lastSyncAttemptAt`, stamped by `syncUser` itself) is older than the minimum
 * interval. Concurrent calls cannot both succeed. The claim stamps the attempt time, so
 * `syncUser` re-stamping it a moment later only moves the window forward.
 */
export async function claimSyncSlot(
  userId: string,
  now: Date = new Date(),
  db: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const { count } = await db.user.updateMany({
    where: {
      id: userId,
      OR: [
        { lastSyncAttemptAt: null },
        { lastSyncAttemptAt: { lt: new Date(now.getTime() - MIN_SYNC_INTERVAL_MS) } },
      ],
    },
    data: { lastSyncAttemptAt: now },
  });
  return count === 1;
}
