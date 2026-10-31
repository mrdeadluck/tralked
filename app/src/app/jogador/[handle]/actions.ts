"use server";

import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { syncUser } from "@/lib/sync/user";

const MIN_INTERVAL_MS = 2 * 60_000;

export type SyncNowResult =
  | {
      ok: true;
      newUnlocks: number;
      levelBefore: number;
      levelAfter: number;
      /** SkillIds que subiram de nível nesta sincronização. */
      skillUps: string[];
    }
  | { ok: false; error: string };

const PRIVATE_PROFILE_ERROR =
  "Seu perfil Steam está privado. Deixe-o público para importar suas conquistas.";

/** Syncs the logged-in user's Steam achievements. Rate-limited to one run per 2 minutes. */
export async function syncNow(): Promise<SyncNowResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Entre com a Steam para sincronizar." };

  // Atomic claim: concurrent clicks cannot both pass the interval check.
  const now = new Date();
  const claimed = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - MIN_INTERVAL_MS) } }],
    },
    data: { lastSyncedAt: now },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "Aguarde um pouco antes de sincronizar de novo." };
  }

  const releaseClaim = () =>
    prisma.user.update({ where: { id: user.id }, data: { lastSyncedAt: user.lastSyncedAt } });

  try {
    const result = await syncUser(user.id);
    const status: string = result.status;
    if (status === "private") {
      await releaseClaim();
      return { ok: false, error: PRIVATE_PROFILE_ERROR };
    }
    return {
      ok: true,
      newUnlocks: result.newUnlocks,
      levelBefore: result.levelBefore,
      levelAfter: result.levelAfter,
      skillUps: result.skillUps,
    };
  } catch {
    await releaseClaim().catch(() => {});
    return { ok: false, error: "Não foi possível sincronizar agora. Tente de novo em instantes." };
  }
}
