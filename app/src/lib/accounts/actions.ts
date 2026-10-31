"use server";

import { after } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { syncPlatformAccount } from "@/lib/sync/platform-user";
import { MIN_SYNC_INTERVAL_MS } from "@/lib/sync/claim";
import { confirmLink, startLink, unlink, type ConfirmLinkFailure } from "./link";

/**
 * Server Actions of the account connections (PSN, Xbox, RetroAchievements). Every action
 * checks the session and validates its argument with zod; the UI (Task 10) only renders.
 */

const platformSchema = z.enum(["psn", "xbox", "retro"]);
const startSchema = z.object({ platform: platformSchema, handle: z.string().trim().min(1).max(40) });
const platformOnlySchema = z.object({ platform: platformSchema });

export type ActionError = { ok: false; error: string };
export type StartLinkActionResult = { ok: true; code: string; expiresAt: string } | ActionError;
export type ConfirmLinkActionResult =
  | { ok: true; handle: string }
  | (ActionError & { reason?: ConfirmLinkFailure });
export type SimpleActionResult = { ok: true } | ActionError;

const NOT_LOGGED_IN: ActionError = { ok: false, error: "Entre na sua conta para conectar plataformas." };
const INVALID: ActionError = { ok: false, error: "Dados inválidos." };

const PLATFORM_NAMES = { psn: "PlayStation", xbox: "Xbox", retro: "RetroAchievements" } as const;
const PROFILE_FIELD = { psn: "Sobre mim", xbox: "bio", retro: "motto" } as const;

function confirmMessage(reason: ConfirmLinkFailure, platform: z.infer<typeof platformSchema>): string {
  const name = PLATFORM_NAMES[platform];
  switch (reason) {
    case "code_missing":
      return `Não encontramos o código no campo "${PROFILE_FIELD[platform]}" do seu perfil ${name}. Salve o código lá e tente de novo (pode levar alguns minutos para aparecer).`;
    case "expired":
      return "O código expirou. Gere um novo código para continuar.";
    case "taken":
      return `Essa conta ${name} já está vinculada a outro usuário do Tralked.`;
    case "private":
      return `Seu perfil ${name} está privado. Deixe os troféus/conquistas visíveis para todos e tente de novo.`;
    case "not_found":
      return `Não encontramos esse perfil ${name}. Confira o nome digitado.`;
    case "too_soon":
      return "Aguarde alguns segundos antes de verificar de novo.";
  }
}

/** Starts linking a PSN/Xbox/RA account: returns the code to paste in the platform profile. */
export async function startLinkAction(input: unknown): Promise<StartLinkActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return INVALID;

  const result = await startLink(user.id, parsed.data.platform, parsed.data.handle);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "already_linked"
          ? "Você já tem uma conta dessa plataforma conectada. Desconecte-a antes de conectar outra."
          : "Nome de usuário inválido para essa plataforma.",
    };
  }
  return { ok: true, code: result.code, expiresAt: result.expiresAt.toISOString() };
}

/** Verifies the code in the profile; on success the first import runs after the response. */
export async function confirmLinkAction(input: unknown): Promise<ConfirmLinkActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = platformOnlySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const { platform } = parsed.data;

  try {
    const result = await confirmLink(user.id, platform);
    if (!result.ok) {
      return { ok: false, reason: result.reason, error: confirmMessage(result.reason, platform) };
    }
    const userId = user.id;
    after(async () => {
      try {
        await syncPlatformAccount(userId, platform);
      } catch (error) {
        console.error(`Link: first ${platform} import failed`, error);
      }
    });
    return { ok: true, handle: result.handle };
  } catch (error) {
    console.error("confirmLinkAction failed", {
      userId: user.id,
      platform,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Não foi possível verificar agora. Tente de novo em instantes." };
  }
}

/** Disconnects the account and removes the progress imported from it. */
export async function unlinkAction(input: unknown): Promise<SimpleActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = platformOnlySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const removed = await unlink(user.id, parsed.data.platform);
  return removed ? { ok: true } : { ok: false, error: "Essa plataforma não está conectada." };
}

/** Imports the latest progress of one linked account now. At most once per 2 minutes. */
export async function syncLinkedAccountAction(input: unknown): Promise<
  { ok: true; newUnlocks: number; levelBefore: number; levelAfter: number } | ActionError
> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = platformOnlySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const { platform } = parsed.data;

  const now = new Date();
  const claimed = await prisma.linkedAccount.updateMany({
    where: {
      userId: user.id,
      platform,
      verifiedAt: { not: null },
      OR: [
        { lastSyncAttemptAt: null },
        { lastSyncAttemptAt: { lt: new Date(now.getTime() - MIN_SYNC_INTERVAL_MS) } },
      ],
    },
    data: { lastSyncAttemptAt: now },
  });
  if (claimed.count === 0) {
    return { ok: false, error: "Aguarde um pouco antes de sincronizar de novo (ou conecte a conta primeiro)." };
  }
  try {
    const result = await syncPlatformAccount(user.id, platform);
    if (result.status === "private") {
      return { ok: false, error: confirmMessage("private", platform) };
    }
    return {
      ok: true,
      newUnlocks: result.newUnlocks,
      levelBefore: result.levelBefore,
      levelAfter: result.levelAfter,
    };
  } catch (error) {
    console.error("syncLinkedAccountAction failed", {
      userId: user.id,
      platform,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Não foi possível sincronizar agora. Tente de novo em instantes." };
  }
}
