"use server";

import { after } from "next/server";
import { z } from "zod";
import { createSession, getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { CONTACT_EMAIL } from "@/lib/legal/contact";
import { syncPlatformAccount } from "@/lib/sync/platform-user";
import { claimSyncSlot, MIN_SYNC_INTERVAL_MS } from "@/lib/sync/claim";
import { syncUser } from "@/lib/sync/user";
import { cancelPendingLink, confirmLink, startLink, unlink, type ConfirmLinkFailure } from "./link";
import { confirmSteamLink } from "./steam-link";

/**
 * Server Actions of the account connections (Steam, PSN, Xbox, RetroAchievements). Every action
 * checks the session and validates its argument with zod; the UI only renders.
 */

const platformSchema = z.enum(["steam", "psn", "xbox", "retro"]);
type Platform = z.infer<typeof platformSchema>;
// Steam accepts a whole profile link (https://steamcommunity.com/profiles/<id>/).
const startSchema = z.object({ platform: platformSchema, handle: z.string().trim().min(1).max(200) });
const platformOnlySchema = z.object({ platform: platformSchema });

export type ActionError = { ok: false; error: string };
export type StartLinkActionResult = { ok: true; code: string; expiresAt: string } | ActionError;
export type ConfirmLinkActionResult =
  /** `recovered`: the Steam belonged to an account of the old Steam login, now this session's. */
  | { ok: true; handle: string; recovered: boolean }
  | (ActionError & { reason?: ConfirmLinkFailure | "has_activity" | "different" });
export type SimpleActionResult = { ok: true } | ActionError;

const NOT_LOGGED_IN: ActionError = { ok: false, error: "Entre na sua conta para conectar plataformas." };
const INVALID: ActionError = { ok: false, error: "Dados inválidos." };

const PLATFORM_NAMES = { steam: "Steam", psn: "PlayStation", xbox: "Xbox", retro: "RetroAchievements" } as const;
const PROFILE_FIELD = { steam: "Resumo", psn: "Sobre mim", xbox: "bio", retro: "motto" } as const;

const waitMessage = (seconds: number) =>
  seconds > 90
    ? `Muitas tentativas. Tente de novo em ${Math.ceil(seconds / 60)} minutos.`
    : `Aguarde ${seconds} segundos antes de tentar de novo.`;

/** Background syncs (after a link or on demand) stop reading titles after this; cron continues. */
const BACKGROUND_SYNC_BUDGET_MS = 50_000;

/**
 * Imports the account after the response. Steam's sync (whole library, new games cataloged) can
 * take minutes; its callers claim the user's sync slot first (claimSyncSlot), so a quick relink
 * or a double click never starts a second one in parallel.
 */
function backgroundSync(userId: string, platform: Platform, label: string) {
  after(async () => {
    try {
      if (platform === "steam") await syncUser(userId);
      else await syncPlatformAccount(userId, platform, { deadline: Date.now() + BACKGROUND_SYNC_BUDGET_MS });
    } catch (error) {
      console.error(`${label}: ${platform} import failed`, error instanceof Error ? error.message : String(error));
    }
  });
}

function confirmMessage(
  reason: ConfirmLinkFailure | "has_activity" | "different",
  platform: Platform,
  retryAfterSec = 30,
): string {
  const name = PLATFORM_NAMES[platform];
  switch (reason) {
    case "has_activity":
      return `Essa conta Steam pertence a uma conta antiga do Tralked, com histórico. Como esta conta já tem atividade, não juntamos as duas automaticamente: escreva para ${CONTACT_EMAIL} e a gente recupera o seu histórico.`;
    case "different":
      return "Esta conta já tem outra conta Steam conectada. Desconecte-a antes de conectar outra.";
    case "code_missing":
      return `Não encontramos o código no campo "${PROFILE_FIELD[platform]}" do seu perfil ${name}. Salve o código lá e tente de novo (pode levar alguns minutos para aparecer).`;
    case "expired":
      return "O código expirou. Gere um novo código para continuar.";
    case "taken":
      return `Essa conta ${name} já está vinculada a outro usuário do Tralked.`;
    case "private":
      return platform === "steam"
        ? "Seu perfil Steam está privado, então não conseguimos ler o Resumo. Deixe o perfil e os detalhes de jogos públicos e tente de novo."
        : `Seu perfil ${name} está privado. Deixe os troféus/conquistas visíveis para todos e tente de novo.`;
    case "not_found":
      return platform === "steam"
        ? "Não encontramos esse perfil Steam. Confira o link ou o nome personalizado."
        : `Não encontramos esse perfil ${name}. Confira o nome digitado.`;
    case "too_soon":
      return waitMessage(retryAfterSec);
  }
}

/** Starts linking a Steam/PSN/Xbox/RA account: returns the code to paste in the platform profile. */
export async function startLinkAction(input: unknown): Promise<StartLinkActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return INVALID;

  const result = await startLink(user.id, parsed.data.platform, parsed.data.handle);
  if (!result.ok) {
    if (result.reason === "too_soon") return { ok: false, error: waitMessage(result.retryAfterSec) };
    return {
      ok: false,
      error:
        result.reason === "already_linked"
          ? "Você já tem uma conta dessa plataforma conectada. Desconecte-a antes de conectar outra."
          : parsed.data.platform === "steam"
            ? "Não reconhecemos esse perfil. Cole o link do seu perfil Steam (steamcommunity.com/id/… ou /profiles/…), o nome personalizado ou o SteamID64."
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
    if (platform === "steam") {
      const result = await confirmSteamLink(user.id);
      if (!result.ok) {
        const retry = result.reason === "too_soon" ? result.retryAfterSec : undefined;
        return { ok: false, reason: result.reason, error: confirmMessage(result.reason, platform, retry) };
      }
      // An account of the old Steam login was recovered: this session moves to it.
      const ownerId = result.claimed?.userId ?? user.id;
      if (result.claimed) await createSession(ownerId);
      if (await claimSyncSlot(ownerId)) backgroundSync(ownerId, platform, "Link");
      return { ok: true, handle: result.handle, recovered: result.claimed !== null };
    }
    const result = await confirmLink(user.id, platform);
    if (!result.ok) {
      const retry = result.reason === "too_soon" ? result.retryAfterSec : undefined;
      return { ok: false, reason: result.reason, error: confirmMessage(result.reason, platform, retry) };
    }
    backgroundSync(user.id, platform, "Link");
    return { ok: true, handle: result.handle, recovered: false };
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
  // A verified account is disconnected; a link still waiting for its code is cancelled.
  const removed =
    (await unlink(user.id, parsed.data.platform)) || (await cancelPendingLink(user.id, parsed.data.platform));
  return removed ? { ok: true } : { ok: false, error: "Essa plataforma não está conectada." };
}

/**
 * Starts importing the latest progress of one linked account (incremental, in the background
 * after the response). At most once per 2 minutes.
 */
export async function syncLinkedAccountAction(
  input: unknown,
): Promise<{ ok: true; message: string } | ActionError> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = platformOnlySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const { platform } = parsed.data;

  if (platform === "steam") {
    // The Steam sync keeps its attempt time on the user (cron and the character sheet share it).
    if (!user.steamId || !(await claimSyncSlot(user.id))) {
      return { ok: false, error: "Aguarde um pouco antes de sincronizar de novo (ou conecte a conta primeiro)." };
    }
    backgroundSync(user.id, platform, "Manual sync");
    return { ok: true, message: "Sincronização iniciada" };
  }

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
  backgroundSync(user.id, platform, "Manual sync");
  return { ok: true, message: "Sincronização iniciada" };
}
