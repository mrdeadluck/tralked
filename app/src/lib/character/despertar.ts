import { prisma } from "@/lib/db";
import { despertarSteps } from "@/lib/engine/despertar";

/**
 * "Despertar": the first time a player's history is imported, their character wakes up and
 * climbs from level 1 to its real level in one sequence. It is shown once per user
 * (`User.despertarShownAt`).
 */

/**
 * The levels to play, or null when there is nothing to show: already shown, never synced
 * (no successful Steam sync and no synced linked account) or still at level 1.
 */
export async function pendingDespertar(userId: string): Promise<number[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      despertarShownAt: true,
      lastSyncedAt: true,
      stats: { select: { level: true } },
      linkedAccounts: {
        where: { linkedAt: { not: null }, lastSyncedAt: { not: null } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!user || user.despertarShownAt) return null;
  const synced = user.lastSyncedAt !== null || user.linkedAccounts.length > 0;
  if (!synced) return null;
  const steps = despertarSteps(1, user.stats?.level ?? 1);
  return steps.length > 0 ? steps : null;
}

/** Records that the sequence was shown. Atomic: returns true only for the first call. */
export async function markDespertarShown(userId: string, now: Date = new Date()): Promise<boolean> {
  const { count } = await prisma.user.updateMany({
    where: { id: userId, despertarShownAt: null },
    data: { despertarShownAt: now },
  });
  return count > 0;
}
