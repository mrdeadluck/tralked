"use server";

import { getSessionUser } from "@/lib/auth/session";
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
    }
  | { ok: false; error: string };

const PRIVATE_PROFILE_ERROR =
  "Seu perfil Steam está privado. Deixe-o público para importar suas conquistas.";

/** Syncs the logged-in user's Steam achievements. Rate-limited to one run per 2 minutes. */
export async function syncNow(): Promise<SyncNowResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Entre com a Steam para sincronizar." };

  try {
    if (!(await claimSyncSlot(user.id))) {
      return { ok: false, error: "Aguarde um pouco antes de sincronizar de novo." };
    }
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
    };
  } catch (error) {
    console.error("syncNow failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Não foi possível sincronizar agora. Tente de novo em instantes." };
  }
}
