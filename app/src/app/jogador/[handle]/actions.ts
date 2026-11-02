"use server";

import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { markDespertarShown, pendingDespertar } from "@/lib/character/despertar";
import { claimSyncSlot } from "@/lib/sync/claim";
import { syncUser } from "@/lib/sync/user";

export type SyncNowResult =
  | {
      ok: true;
      newUnlocks: number;
      levelBefore: number;
      levelAfter: number;
      /** SkillIds que subiram de nível nesta sincronização. */
      skillUps: string[];
      /** Levels of the "Despertar" sequence when it was never shown (first sync); else null. */
      despertarSteps: number[] | null;
      /** Total XP this sync added (achievements, platinums, hours, missions). */
      xpGained: number;
      /** Missions this sync completed, with their reward. */
      missionsDone: { title: string; rewardXp: number }[];
    }
  | { ok: false; error: string };

const PRIVATE_PROFILE_ERROR =
  "Seu perfil Steam está privado. Deixe-o público para importar suas conquistas.";

/** Syncs the logged-in user's Steam achievements. Rate-limited to one run per 2 minutes. */
export async function syncNow(): Promise<SyncNowResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Entre na sua conta para sincronizar." };

  try {
    if (!(await claimSyncSlot(user.id))) {
      return { ok: false, error: "Aguarde um pouco antes de sincronizar de novo." };
    }
    const startedAt = new Date();
    const xpOf = () =>
      prisma.userStats.findUnique({ where: { userId: user.id }, select: { totalXp: true } }).then((r) => r?.totalXp ?? 0);
    const xpBefore = await xpOf();
    const result = await syncUser(user.id);
    if (result.status === "private") {
      return { ok: false, error: PRIVATE_PROFILE_ERROR };
    }
    return {
      ok: true,
      newUnlocks: result.newUnlocks,
      levelBefore: result.levelBefore,
      levelAfter: result.levelAfter,
      skillUps: result.skillUps,
      despertarSteps: await pendingDespertar(user.id),
      xpGained: Math.max(0, (await xpOf()) - xpBefore),
      missionsDone: await prisma.mission.findMany({
        where: { userId: user.id, completedAt: { gte: startedAt } },
        select: { title: true, rewardXp: true },
      }),
    };
  } catch (error) {
    console.error("syncNow failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Não foi possível sincronizar agora. Tente de novo em instantes." };
  }
}

/** Records that the owner saw the "Despertar" sequence, so it never plays again. */
export async function markDespertarShownAction(): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user) return { ok: false };
  await markDespertarShown(user.id);
  return { ok: true };
}
