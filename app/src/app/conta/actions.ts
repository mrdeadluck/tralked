"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { deleteAccount } from "@/lib/accounts/delete";
import { visibilityTags } from "@/lib/accounts/privacy";
import { DELETE_CONFIRMATION, profileSettingsSchema, updateProfileSettings } from "@/lib/accounts/settings";
import { changeEmail, changePassword, emailSchema, passwordSchema } from "@/lib/auth/credentials";
import { confirmationResendLimiter, sendEmailConfirmation } from "@/lib/auth/email-verification";
import type { AuthFormState } from "@/lib/auth/form-state";
import { PASSWORD_MAX } from "@/lib/auth/limits";
import { destroySession, getSessionUser } from "@/lib/auth/session";
import { FORUM_TAG, GALLERY_TAG, photoTag, threadTag } from "@/lib/community/cached";
import { mailAvailable } from "@/lib/mail/mailer";
import { MAIL_OFF_MESSAGE } from "@/lib/mail/messages";
import { gameTag } from "@/lib/queries/games-cached";
import { playerTag } from "@/lib/queries/players-cached";

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
  const { visibilityChanged } = await updateProfileSettings(user.id, parsed.data);
  // Cached public listings (gallery, game pages, forum), the user's photo pages and profile follow
  // the new visibility at once, not when their cache expires.
  if (visibilityChanged) for (const tag of await visibilityTags(user.id)) updateTag(tag);
  return { ok: true };
}

const formText = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
};

function firstErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}

const currentPasswordField = z.string().max(PASSWORD_MAX).optional();
const WRONG_CURRENT = { current: "A senha atual não confere." };

/** Sets the login e-mail of the logged-in user (asks the current password when there is one). */
export async function changeEmailAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const user = await getSessionUser();
  if (!user) return { message: "Entre na sua conta para continuar." };
  const values = { email: formText(formData, "email")?.trim() ?? "" };
  const parsed = z
    .object({ email: emailSchema, current: currentPasswordField })
    .safeParse({ email: formText(formData, "email"), current: formText(formData, "current") });
  if (!parsed.success) return { errors: firstErrors(parsed.error), values };

  const result = await changeEmail(user.id, parsed.data.email, parsed.data.current);
  if (!result.ok) {
    return {
      errors: result.reason === "wrong_password" ? WRONG_CURRENT : { email: "Esse e-mail já é usado por outra conta." },
      values,
    };
  }
  if (!result.changed) {
    return { done: true, message: "E-mail salvo. Use-o para entrar no Tralked.", values: { email: parsed.data.email } };
  }
  // The page shows "e-mail não confirmado" for the new address.
  refresh();
  // The new e-mail starts unconfirmed: send its confirmation link after the response.
  const sending = mailAvailable();
  if (sending) {
    const userId = user.id;
    after(async () => {
      try {
        await sendEmailConfirmation(userId);
      } catch (error) {
        console.error("E-mail confirmation failed", error instanceof Error ? error.message : String(error));
      }
    });
  }
  return {
    done: true,
    message: sending
      ? "E-mail salvo. Use-o para entrar no Tralked. Enviamos um link para confirmar o endereço novo."
      : "E-mail salvo. Use-o para entrar no Tralked.",
    values: { email: parsed.data.email },
  };
}

export type ResendConfirmationResult = { ok: true; message: string } | { ok: false; error: string };

/** "Reenviar e-mail de confirmação" (/conta). Limited per account; never sends to a confirmed e-mail. */
export async function resendEmailConfirmationAction(): Promise<ResendConfirmationResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Entre na sua conta para continuar." };
  if (!user.email) return { ok: false, error: "Salve um e-mail de login primeiro." };
  if (user.emailVerifiedAt) return { ok: true, message: "Este e-mail já está confirmado." };
  if (!mailAvailable()) return { ok: false, error: MAIL_OFF_MESSAGE };
  const limit = confirmationResendLimiter.hit(user.id);
  if (!limit.ok) {
    return {
      ok: false,
      error: `Você já pediu vários e-mails de confirmação. Tente de novo em ${Math.max(1, Math.ceil(limit.retryAfterSec / 60))} minuto(s).`,
    };
  }
  const status = await sendEmailConfirmation(user.id);
  if (status === "already") return { ok: true, message: "Este e-mail já está confirmado." };
  if (status === "sent" || status === "logged") {
    return { ok: true, message: `Enviamos um novo link de confirmação para ${user.email}. Ele vale 7 dias.` };
  }
  return { ok: false, error: "Não deu para enviar o e-mail agora. Tente de novo em alguns minutos." };
}

/** Sets a new password for the logged-in user (asks the current one when there is one). */
export async function changePasswordAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const user = await getSessionUser();
  if (!user) return { message: "Entre na sua conta para continuar." };
  const parsed = z
    .object({
      current: currentPasswordField,
      password: passwordSchema,
      confirm: z.string({ error: "Repita a nova senha." }).max(PASSWORD_MAX),
    })
    .refine((data) => data.password === data.confirm, { path: ["confirm"], error: "As senhas não são iguais." })
    .safeParse({
      current: formText(formData, "current"),
      password: formText(formData, "password"),
      confirm: formText(formData, "confirm"),
    });
  if (!parsed.success) return { errors: firstErrors(parsed.error) };

  const result = await changePassword(user.id, parsed.data.current, parsed.data.password);
  if (!result.ok) return { errors: WRONG_CURRENT };
  return { done: true, message: user.passwordHash ? "Senha trocada." : "Senha criada. Agora você entra com e-mail e senha." };
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
    // The profile page answers 404 from now on.
    updateTag(playerTag(user.handle));
  }
  redirect("/?conta=excluida");
}
