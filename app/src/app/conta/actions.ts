"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteAccount } from "@/lib/accounts/delete";
import { DELETE_CONFIRMATION, profileSettingsSchema, updateProfileSettings } from "@/lib/accounts/settings";
import { destroySession, getSessionUser } from "@/lib/auth/session";
import { FORUM_TAG, GALLERY_TAG, photoTag, threadTag } from "@/lib/community/cached";
import { gameTag } from "@/lib/queries/games-cached";

export type AccountActionResult = { ok: true } | { ok: false; error: string };

const NOT_LOGGED_IN: AccountActionResult = { ok: false, error: "Entre na sua conta para continuar." };

/** Saves the bio and the profile visibility of the logged-in user. */
export async function updateProfileAction(input: unknown): Promise<AccountActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = profileSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  await updateProfileSettings(user.id, parsed.data);
  return { ok: true };
}

const deleteSchema = z.object({ confirmation: z.literal(DELETE_CONFIRMATION) });

/**
 * Deletes the logged-in user's account (LGPD), ends the session and goes to the home page.
 * Requires the typed confirmation word.
 */
export async function deleteAccountAction(input: unknown): Promise<AccountActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  if (!deleteSchema.safeParse(input).success) {
    return { ok: false, error: `Digite ${DELETE_CONFIRMATION} para confirmar.` };
  }

  let deleted;
  try {
    deleted = await deleteAccount(user.id);
  } catch (error) {
    console.error("deleteAccountAction failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Não foi possível excluir a conta agora. Tente de novo em instantes." };
  }

  await destroySession();
  if (deleted) {
    // Cached public pages that showed the user's name as author.
    updateTag(GALLERY_TAG);
    updateTag(FORUM_TAG);
    for (const id of deleted.photoIds) updateTag(photoTag(id));
    for (const id of deleted.threadIds) updateTag(threadTag(id));
    for (const slug of deleted.guideGameSlugs) updateTag(gameTag(slug));
  }
  redirect("/?conta=excluida");
}
