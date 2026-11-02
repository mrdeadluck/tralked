import type { Prisma } from "@/generated/prisma/client";
import { formatCompact } from "@/lib/xp-format";

type Db = Prisma.TransactionClient;

/**
 * Progress notifications (the return triggers of the reward loop): level up and mission done.
 * Each one is a single insert written only when the thing actually happened, so they stay cheap.
 */

async function profileHref(db: Db, userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { handle: true } });
  return user ? `/jogador/${encodeURIComponent(user.handle)}` : null;
}

/** "Você chegou ao nível 42". One notification per level change (not one per level crossed). */
export async function notifyLevelUp(db: Db, userId: string, from: number, to: number, now = new Date()): Promise<void> {
  if (to <= from) return;
  const href = await profileHref(db, userId);
  if (!href) return;
  const jump = to - from;
  await db.notification.create({
    data: {
      userId,
      kind: "level_up",
      title: `Você chegou ao nível ${to}`,
      body: jump > 1 ? `Subiu ${jump} níveis de uma vez. Veja sua ficha.` : "Veja o que mudou na sua ficha.",
      href,
      createdAt: now,
    },
  });
}

/** "Missão concluída: Desbloqueie 5 conquistas" with its reward. */
export async function notifyMissionDone(
  db: Db,
  userId: string,
  mission: { title: string; rewardXp: number; kind: string },
  now = new Date(),
): Promise<void> {
  const href = await profileHref(db, userId);
  if (!href) return;
  await db.notification.create({
    data: {
      userId,
      kind: "mission_done",
      title: `Missão ${mission.kind === "weekly" ? "semanal" : "do dia"} concluída: ${mission.title}`,
      body: `+${formatCompact(mission.rewardXp)} XP na sua ficha.`,
      href,
      createdAt: now,
    },
  });
}
