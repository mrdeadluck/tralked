"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { confirmationDelivered, confirmSubscription, newsletterEmailSchema, subscribe } from "./subscribe";

/** `sent`: a confirmation link went out. `registered`: stored, but no e-mail could be sent (no provider). */
export type NewsletterResult =
  | { ok: true; email: string; delivery: "sent" | "registered" }
  | { ok: false; error: string };

const inputSchema = z.strictObject({ email: newsletterEmailSchema });

/** Sign-ups per IP address in the window (in memory, per server instance, like the other limiters). */
// ("use server" modules may only export async functions, so the limit stays private; tests use 5.)
const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60_000;
const byIp = new Map<string, number[]>();

function takeIpSlot(ip: string, now: number): boolean {
  const recent = (byIp.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= IP_LIMIT) {
    byIp.set(ip, recent);
    return false;
  }
  if (byIp.size > 10_000) byIp.clear();
  byIp.set(ip, [...recent, now]);
  return true;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}

/** Newsletter form (no login needed): stores the address and sends the confirmation link. */
export async function subscribeNewsletterAction(input: unknown): Promise<NewsletterResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "E-mail inválido." };
  if (!takeIpSlot(await clientIp(), Date.now())) {
    return { ok: false, error: "Muitas inscrições seguidas daqui. Tente de novo em alguns minutos." };
  }
  try {
    await subscribe(parsed.data.email);
  } catch (error) {
    console.error("Newsletter: could not subscribe", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "Não deu para inscrever agora. Tente de novo em alguns minutos." };
  }
  return { ok: true, email: parsed.data.email, delivery: confirmationDelivered() ? "sent" : "registered" };
}

const confirmSchema = z.strictObject({ email: z.string().max(300), token: z.string().max(200) });

/** "Confirmar inscrição" button of the confirmation page (a form POST, works without JavaScript). */
export async function confirmNewsletterAction(formData: FormData): Promise<void> {
  const parsed = confirmSchema.safeParse({ email: formData.get("email"), token: formData.get("token") });
  const result = parsed.success ? await confirmSubscription(parsed.data.email, parsed.data.token) : "invalid";
  redirect(`/newsletter/confirmar?resultado=${result}`);
}
