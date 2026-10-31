import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

/*
 * Newsletter with double opt-in. The confirmation token is an HMAC of the e-mail (keyed by
 * SESSION_SECRET), so no extra column is needed and a token cannot be forged for another address.
 * There is no mail provider yet: outside production the confirmation link is printed to the
 * server console (simulated e-mail).
 */

export const newsletterEmailSchema = z
  .string({ error: "Digite seu e-mail." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Esse e-mail não parece válido." }).max(254, { error: "Esse e-mail é longo demais." }));

export function newsletterToken(email: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(`newsletter:${email}`).digest("base64url");
}

export function confirmationUrl(email: string): string {
  const url = new URL("/newsletter/confirmar", env.APP_URL);
  url.searchParams.set("email", email);
  url.searchParams.set("token", newsletterToken(email));
  return url.toString();
}

/** At most one confirmation e-mail per address in this window (in memory, per instance). */
export const RESEND_WINDOW_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

/** Simulated delivery of the confirmation e-mail (no provider configured). */
function deliverConfirmation(email: string) {
  if (process.env.NODE_ENV === "production") return;
  console.info(`[newsletter] Link de confirmação para ${email}: ${confirmationUrl(email)}`);
}

/**
 * Registers the address (unconfirmed) and sends the confirmation link. An address that is already
 * confirmed is left as is, and a repeated request within RESEND_WINDOW_MS sends nothing (no mail
 * bombing someone else's inbox). The caller answers the same way in every case, so the form never
 * tells whether an address is subscribed. Returns whether a confirmation was sent.
 */
export async function subscribe(email: string, now: number = Date.now()): Promise<boolean> {
  const row = await prisma.newsletterSubscriber.upsert({
    where: { email },
    create: { email },
    update: {},
  });
  if (row.confirmedAt) return false;
  const previous = lastSent.get(email);
  if (previous !== undefined && now - previous < RESEND_WINDOW_MS) return false;
  if (lastSent.size > 10_000) lastSent.clear();
  lastSent.set(email, now);
  deliverConfirmation(email);
  return true;
}

export type ConfirmResult = "confirmed" | "already" | "invalid";

/** Confirms a subscription from the e-mailed link (`?email=&token=`). */
export async function confirmSubscription(
  rawEmail: unknown,
  token: unknown,
  now: Date = new Date(),
): Promise<ConfirmResult> {
  const parsed = newsletterEmailSchema.safeParse(rawEmail);
  if (!parsed.success || typeof token !== "string") return "invalid";
  const email = parsed.data;
  const expected = Buffer.from(newsletterToken(email));
  const given = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "invalid";

  const row = await prisma.newsletterSubscriber.findUnique({ where: { email } });
  if (!row) return "invalid";
  if (row.confirmedAt) return "already";
  await prisma.newsletterSubscriber.update({ where: { email }, data: { confirmedAt: now } });
  return "confirmed";
}
