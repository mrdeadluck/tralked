"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createSession, getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { platformAvailable } from "@/lib/integrations/availability";
import { CONTACT_EMAIL } from "@/lib/legal/contact";
import { claimSyncSlot, MIN_SYNC_INTERVAL_MS } from "@/lib/sync/claim";
import { CODE_PLATFORMS } from "@/lib/sync/platform-library";
import { syncPlatformAccount } from "@/lib/sync/platform-user";
import { syncUser } from "@/lib/sync/user";
import { saveConnection, type SaveConnectionResult } from "./connect";
import { cancelClaim, confirmClaim, startClaim, type ConfirmClaimFailure } from "./link";
import { confirmSteamClaim } from "./steam-link";
import {
  cancelVerification,
  checkVerification,
  startVerification,
  type CheckVerificationResult,
} from "./verify";
import { verifyFailureMessage } from "./verify-messages";

/**
 * Server Actions of the account connections (Steam, PSN, Xbox, RetroAchievements). Every action
 * checks the session and validates its input with zod; the UI only renders.
 */

const PLATFORMS = ["steam", "psn", "xbox", "retro"] as const;
const platformSchema = z.enum(PLATFORMS);
type Platform = z.infer<typeof platformSchema>;
// Steam accepts a whole profile link (https://steamcommunity.com/profiles/<id>/).
const fieldSchema = z.string().max(200).optional();
const saveSchema = z.object({
  steam: fieldSchema,
  psn: fieldSchema,
  xbox: fieldSchema,
  retro: fieldSchema,
  /**
   * Platforms whose disconnection (or replacement) the user confirmed, in the dialog or in the
   * server-rendered confirmation step (whose button sends them comma-separated).
   */
  confirmar: z.array(platformSchema).max(PLATFORMS.length * 2),
  /** Platforms to disconnect whose field is disabled ("Em breve"), by their own button. */
  desconectar: z.array(platformSchema).max(PLATFORMS.length * 2),
});

/** `confirmar`/`desconectar` entries, each possibly a comma-separated list. */
const listOf = (entries: FormDataEntryValue[]) =>
  // A file is kept as is, so the schema refuses it.
  entries.flatMap((entry): unknown[] => (typeof entry === "string" ? entry.split(",").filter(Boolean) : [entry]));
const claimSchema = z.object({ platform: platformSchema, handle: z.string().trim().min(1).max(200) });
const platformOnlySchema = z.object({ platform: platformSchema });

export type ActionError = { ok: false; error: string };
export type StartClaimActionResult = { ok: true; code: string; expiresAt: string } | ActionError;
export type ConfirmClaimActionResult =
  /** `recovered`: the Steam belonged to an account of the old Steam login, now this session's. */
  | { ok: true; handle: string; recovered: boolean }
  | (ActionError & { reason?: ConfirmClaimFailure | "has_activity" | "different" });
export type SimpleActionResult = { ok: true; message?: string } | ActionError;
export type StartVerificationActionResult = { ok: true; code: string; expiresAt: string } | ActionError;
export type CheckVerificationActionResult =
  | { ok: true; handle: string }
  | (ActionError & { reason: Exclude<CheckVerificationResult, { ok: true }>["reason"]; retryAfterSec?: number });

/** Result of one field of the "Serviços" form. */
export type FieldOutcome = {
  tone: "ok" | "error";
  message: string;
  /** The account is on another profile: offer "É sua? Reivindicar". */
  claimable?: boolean;
  /** Point to the privacy help. */
  privacyHelp?: boolean;
  /** What the user typed, kept in the field after a refusal. */
  typed?: string;
  /** The change removes the XP of the connected account: the form asks, then sends it again. */
  confirm?: "unlink" | "replace";
};

export type SaveConnectionsState = {
  /** Bumped on every answer, so the form remounts its fields with the saved values. */
  version: number;
  fields: Partial<Record<Platform, FieldOutcome>>;
  /** A problem with the whole submission (session, invalid data). */
  error: string | null;
};

const NOT_LOGGED_IN: ActionError = { ok: false, error: "Entre na sua conta para conectar plataformas." };
const INVALID: ActionError = { ok: false, error: "Dados inválidos." };

const PLATFORM_NAMES = { steam: "Steam", psn: "PlayStation", xbox: "Xbox", retro: "RetroAchievements" } as const;
const UNLOCKS = { steam: "conquistas", psn: "troféus", xbox: "conquistas", retro: "conquistas" } as const;
const PROFILE_FIELD = { steam: "Resumo", psn: "Sobre mim", xbox: "bio", retro: "motto" } as const;
const INVALID_HANDLE = {
  steam:
    "Não reconhecemos esse perfil. Cole o link do seu perfil Steam (steamcommunity.com/id/… ou /profiles/…), o nome personalizado ou o SteamID64.",
  psn: "ID online inválido: use de 3 a 16 letras, números, hífen ou sublinhado.",
  xbox: "Gamertag inválida: use letras, números e espaços (até 16), com o #1234 do final se tiver.",
  retro: "Usuário inválido: use de 2 a 32 letras, números ou sublinhado.",
} as const;

const waitMessage = (seconds: number) =>
  seconds > 90
    ? `Muitas tentativas. Tente de novo em ${Math.ceil(seconds / 60)} minutos.`
    : `Aguarde ${seconds} segundos antes de tentar de novo.`;

const privateMessage = (platform: Platform) =>
  platform === "steam"
    ? "Seu perfil Steam está privado. Deixe o perfil e os detalhes de jogos públicos e tente de novo."
    : `Seu perfil ${PLATFORM_NAMES[platform]} está privado. Deixe os ${UNLOCKS[platform]} visíveis para todos e tente de novo.`;

const notFoundMessage = (platform: Platform) =>
  platform === "steam"
    ? "Não encontramos esse perfil Steam. Confira o link ou o nome personalizado."
    : `Não encontramos esse perfil ${PLATFORM_NAMES[platform]}. Confira o nome digitado.`;

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

/** Starts the first import of a connection made just now. */
async function importNow(userId: string, platform: Platform, label: string) {
  if (platform !== "steam" || (await claimSyncSlot(userId))) backgroundSync(userId, platform, label);
}

function fieldOutcome(platform: Platform, result: SaveConnectionResult, typed: string): FieldOutcome | null {
  const name = PLATFORM_NAMES[platform];
  switch (result.status) {
    case "unchanged":
      return null;
    case "linked":
      return {
        tone: "ok",
        message: `Conectada como ${result.handle}. Estamos importando suas ${UNLOCKS[platform]}; elas aparecem aqui em instantes.`,
      };
    case "renamed":
      return { tone: "ok", message: `Mesma conta ${name}, nome atualizado para ${result.handle}.` };
    case "unlinked":
      return { tone: "ok", message: `${name} desconectada. O XP que veio dessa conta foi anulado.` };
    case "needs_confirm":
      return {
        tone: "error",
        typed,
        confirm: result.action,
        message:
          result.action === "unlink"
            ? `Confirme para desconectar a ${name}: o XP vindo dessa conta é anulado.`
            : `Confirme a troca de conta da ${name}: o XP vindo da conta atual é anulado.`,
      };
    case "invalid":
      return { tone: "error", typed, message: INVALID_HANDLE[platform] };
    case "not_found":
      return { tone: "error", typed, message: notFoundMessage(platform) };
    case "private":
      return { tone: "error", typed, message: privateMessage(platform), privacyHelp: true };
    case "taken":
      return { tone: "error", typed, message: "Essa conta já está conectada a outro perfil.", claimable: true };
    case "unavailable":
      return { tone: "error", typed, message: `A conexão com a ${name} ainda não está disponível.` };
    case "error":
      return { tone: "error", typed, message: `Não foi possível consultar a ${name} agora. Tente de novo em instantes.` };
    case "too_soon":
      return { tone: "error", typed, message: waitMessage(result.retryAfterSec) };
  }
}

/**
 * Saves the "Serviços" form: every field present is applied (disabled "Em breve" fields are not
 * sent), each with its own result. New connections start importing after the response.
 */
export async function saveConnectionsAction(
  previous: SaveConnectionsState,
  formData: FormData,
): Promise<SaveConnectionsState> {
  const version = previous.version + 1;
  const user = await getSessionUser();
  if (!user) return { version, fields: {}, error: NOT_LOGGED_IN.error };
  const text = (key: string) => {
    const value = formData.get(key);
    return value === null ? undefined : typeof value === "string" ? value : null;
  };
  const parsed = saveSchema.safeParse({
    steam: text("steam"),
    psn: text("psn"),
    xbox: text("xbox"),
    retro: text("retro"),
    confirmar: listOf(formData.getAll("confirmar")),
    desconectar: listOf(formData.getAll("desconectar")),
  });
  if (!parsed.success) return { version, fields: {}, error: INVALID.error };

  const confirmed = new Set(parsed.data.confirmar);
  const disconnect = new Set(parsed.data.desconectar);
  const fields: SaveConnectionsState["fields"] = {};
  for (const platform of PLATFORMS) {
    const value = disconnect.has(platform) ? "" : parsed.data[platform];
    if (value === undefined) continue;
    try {
      const result = await saveConnection(user.id, platform, value, { confirmed: confirmed.has(platform) });
      const outcome = fieldOutcome(platform, result, value);
      if (outcome) fields[platform] = outcome;
      if (result.status === "linked") await importNow(user.id, platform, "Link");
    } catch (error) {
      console.error("saveConnectionsAction failed", {
        userId: user.id,
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
      fields[platform] = { tone: "error", typed: value, message: "Não foi possível salvar agora. Tente de novo em instantes." };
    }
  }
  refresh();
  return { version, fields, error: null };
}

/** Starts claiming an account that is on another profile: returns the code to paste in its profile. */
export async function startClaimAction(input: unknown): Promise<StartClaimActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const { platform } = parsed.data;

  const result = await startClaim(user.id, platform, parsed.data.handle);
  if (!result.ok) {
    if (result.reason === "too_soon") return { ok: false, error: waitMessage(result.retryAfterSec) };
    return {
      ok: false,
      error:
        result.reason === "already_linked"
          ? `Você já tem uma conta ${PLATFORM_NAMES[platform]} conectada. Esvazie o campo e salve para desconectá-la antes de reivindicar outra.`
          : result.reason === "unavailable"
            ? `A conexão com a ${PLATFORM_NAMES[platform]} ainda não está disponível.`
            : INVALID_HANDLE[platform],
    };
  }
  refresh();
  return { ok: true, code: result.code, expiresAt: result.expiresAt.toISOString() };
}

function claimMessage(reason: ConfirmClaimFailure | "has_activity" | "different", platform: Platform, retryAfterSec = 30): string {
  const name = PLATFORM_NAMES[platform];
  switch (reason) {
    case "has_activity":
      return `Essa conta Steam pertence a uma conta antiga do Tralked, com histórico. Como esta conta já tem atividade, não juntamos as duas automaticamente: escreva para ${CONTACT_EMAIL} e a gente recupera o seu histórico.`;
    case "different":
      return "Esta conta já tem outra conta Steam conectada. Desconecte-a antes de reivindicar outra.";
    case "code_missing":
      return `Não encontramos o código no campo "${PROFILE_FIELD[platform]}" do seu perfil ${name}. Salve o código lá e tente de novo (pode levar alguns minutos para aparecer).`;
    case "expired":
      return "O código expirou. Gere um novo código para continuar.";
    case "taken":
      return `Essa conta ${name} acabou de ser conectada por outra pessoa. Tente de novo.`;
    case "private":
      return platform === "steam"
        ? "Seu perfil Steam está privado, então não conseguimos ler o Resumo. Deixe o perfil e os detalhes de jogos públicos e tente de novo."
        : privateMessage(platform);
    case "not_found":
      return notFoundMessage(platform);
    case "too_soon":
      return waitMessage(retryAfterSec);
  }
}

/**
 * Verifies the claim's code in the profile; proven, the account moves to this user (verified)
 * and its first import runs after the response.
 */
export async function confirmClaimAction(input: unknown): Promise<ConfirmClaimActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = platformOnlySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const { platform } = parsed.data;

  try {
    if (platform === "steam") {
      const result = await confirmSteamClaim(user.id);
      if (!result.ok) {
        const retry = result.reason === "too_soon" ? result.retryAfterSec : undefined;
        return { ok: false, reason: result.reason, error: claimMessage(result.reason, platform, retry) };
      }
      // An account of the old Steam login was recovered: this session moves to it.
      const ownerId = result.recovered?.userId ?? user.id;
      if (result.recovered) await createSession(ownerId);
      await importNow(ownerId, platform, "Claim");
      refresh();
      return { ok: true, handle: result.handle, recovered: result.recovered !== null };
    }
    const result = await confirmClaim(user.id, platform);
    if (!result.ok) {
      const retry = result.reason === "too_soon" ? result.retryAfterSec : undefined;
      return { ok: false, reason: result.reason, error: claimMessage(result.reason, platform, retry) };
    }
    await importNow(user.id, platform, "Claim");
    refresh();
    return { ok: true, handle: result.handle, recovered: false };
  } catch (error) {
    console.error("confirmClaimAction failed", {
      userId: user.id,
      platform,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Não foi possível verificar agora. Tente de novo em instantes." };
  }
}

/** Cancels a claim still waiting for its code. */
export async function cancelClaimAction(input: unknown): Promise<SimpleActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = platformOnlySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const cancelled = await cancelClaim(user.id, parsed.data.platform);
  refresh();
  return cancelled ? { ok: true } : { ok: false, error: "Não há reivindicação pendente nessa plataforma." };
}

/**
 * "Precisa sincronizar agora?": starts importing the latest progress of every active connection
 * (incremental, in the background after the response), each at most once per 2 minutes.
 */
export async function syncConnectionsAction(): Promise<SimpleActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;

  const now = new Date();
  const started: Platform[] = [];
  // The Steam sync keeps its attempt time on the user (cron and the character sheet share it).
  if (user.steamId && (await claimSyncSlot(user.id))) {
    backgroundSync(user.id, "steam", "Manual sync");
    started.push("steam");
  }
  for (const platform of CODE_PLATFORMS) {
    if (!platformAvailable(platform)) continue;
    const claimed = await prisma.linkedAccount.updateMany({
      where: {
        userId: user.id,
        platform,
        linkedAt: { not: null },
        OR: [
          { lastSyncAttemptAt: null },
          { lastSyncAttemptAt: { lt: new Date(now.getTime() - MIN_SYNC_INTERVAL_MS) } },
        ],
      },
      data: { lastSyncAttemptAt: now },
    });
    if (claimed.count > 0) {
      backgroundSync(user.id, platform, "Manual sync");
      started.push(platform);
    }
  }
  if (started.length === 0) {
    return { ok: false, error: "Nada para sincronizar agora: aguarde um pouco (ou conecte uma conta primeiro)." };
  }
  refresh();
  return {
    ok: true,
    message: `Sincronização iniciada: ${started.map((p) => PLATFORM_NAMES[p]).join(", ")}. As conquistas novas aparecem em instantes.`,
  };
}

/** "Verificar conta": a code to paste in the profile of the connected account. */
export async function startVerificationAction(input: unknown): Promise<StartVerificationActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = platformOnlySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const { platform } = parsed.data;

  const result = await startVerification(user.id, platform);
  if (!result.ok) {
    const error =
      result.reason === "too_soon"
        ? waitMessage(result.retryAfterSec)
        : result.reason === "already_verified"
          ? `Sua conta ${PLATFORM_NAMES[platform]} já está verificada.`
          : result.reason === "unavailable"
            ? `A conexão com a ${PLATFORM_NAMES[platform]} ainda não está disponível.`
            : `Conecte uma conta ${PLATFORM_NAMES[platform]} antes de verificar.`;
    refresh();
    return { ok: false, error };
  }
  refresh();
  return { ok: true, code: result.code, expiresAt: result.expiresAt.toISOString() };
}

/** "Verificar agora": reads the profile for the code; found, the connection becomes verified. */
export async function checkVerificationAction(input: unknown): Promise<CheckVerificationActionResult> {
  const user = await getSessionUser();
  if (!user) return { ...NOT_LOGGED_IN, reason: "not_connected" };
  const parsed = platformOnlySchema.safeParse(input);
  if (!parsed.success) return { ...INVALID, reason: "not_connected" };
  const { platform } = parsed.data;
  const name = PLATFORM_NAMES[platform];

  let result: CheckVerificationResult;
  try {
    result = await checkVerification(user.id, platform);
  } catch (error) {
    console.error("checkVerificationAction failed", {
      userId: user.id,
      platform,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "error", error: verifyFailureMessage("error", platform) };
  }
  refresh();
  if (result.ok) return { ok: true, handle: result.handle };
  switch (result.reason) {
    case "too_soon":
      return { ok: false, reason: result.reason, retryAfterSec: result.retryAfterSec, error: waitMessage(result.retryAfterSec) };
    case "expired":
      return { ok: false, reason: result.reason, error: "O código expirou. Gere um novo código para continuar." };
    case "already_verified":
      return { ok: false, reason: result.reason, error: `Sua conta ${name} já está verificada.` };
    case "unavailable":
      return { ok: false, reason: result.reason, error: `A conexão com a ${name} ainda não está disponível.` };
    case "not_connected":
      return { ok: false, reason: result.reason, error: `Conecte uma conta ${name} antes de verificar.` };
    default:
      return { ok: false, reason: result.reason, error: verifyFailureMessage(result.reason, platform) };
  }
}

/** Gives up a verification in progress (the connection stays, unverified). */
export async function cancelVerificationAction(input: unknown): Promise<SimpleActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = platformOnlySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  await cancelVerification(user.id, parsed.data.platform);
  refresh();
  return { ok: true };
}
