"use server";

import { z } from "zod";
import { newsletterEmailSchema, subscribe } from "./subscribe";

export type NewsletterResult = { ok: true; email: string } | { ok: false; error: string };

const inputSchema = z.strictObject({ email: newsletterEmailSchema });

/** Newsletter form (no login needed): stores the address and sends the confirmation link. */
export async function subscribeNewsletterAction(input: unknown): Promise<NewsletterResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "E-mail inválido." };
  try {
    await subscribe(parsed.data.email);
  } catch (error) {
    console.error("Newsletter: could not subscribe", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "Não deu para inscrever agora. Tente de novo em alguns minutos." };
  }
  return { ok: true, email: parsed.data.email };
}
