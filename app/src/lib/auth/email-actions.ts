"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { confirmEmail, confirmResultToken } from "./email-verification";

const confirmSchema = z.strictObject({ token: z.string().max(200) });

/**
 * "Confirmar e-mail" button of /confirmar-email (a form POST, works without JavaScript). The
 * signed link is the credential, like a password reset link: no session needed.
 */
export async function confirmEmailAction(formData: FormData): Promise<void> {
  const parsed = confirmSchema.safeParse({ token: formData.get("token") });
  const result = parsed.success ? await confirmEmail(parsed.data.token) : "invalid";
  // Signed and short-lived, so the success page only shows right after this POST.
  redirect(`/confirmar-email?resultado=${encodeURIComponent(confirmResultToken(result))}`);
}
