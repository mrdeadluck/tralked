"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { confirmEmail } from "./email-verification";

const confirmSchema = z.strictObject({ token: z.string().max(200) });

/**
 * "Confirmar e-mail" button of /confirmar-email (a form POST, works without JavaScript). The
 * signed link is the credential, like a password reset link: no session needed.
 */
export async function confirmEmailAction(formData: FormData): Promise<void> {
  const parsed = confirmSchema.safeParse({ token: formData.get("token") });
  const result = parsed.success ? await confirmEmail(parsed.data.token) : "invalid";
  redirect(`/confirmar-email?resultado=${result}`);
}
