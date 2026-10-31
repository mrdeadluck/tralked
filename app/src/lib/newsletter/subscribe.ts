import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { delivered, mailAvailable, sendMail } from "@/lib/mail/mailer";
import { newsletterConfirmationEmail } from "@/lib/mail/templates";

/*
 * Newsletter with double opt-in. The confirmation token is `<expiry>.<HMAC(email, expiry)>` keyed by
 * SESSION_SECRET: no extra column, it cannot be forged for another address and it stops working
 * after TOKEN_TTL_DAYS. The link only opens a page; confirming takes a POST (a button), so mail
 * scanners that prefetch links never confirm anything.
 *
 * The confirmation goes through lib/mail (Resend with RESEND_API_KEY; the server log outside
 * production without it). In production without a key the address is only registered, and the
 * form says so.
 */

export const TOKEN_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

export const newsletterEmailSchema = z
  .string({ error: "Digite seu e-mail." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Esse e-mail não parece válido." }).max(254, { error: "Esse e-mail é longo demais." }));

const sign = (email: string, expiresAt: number) =>
  createHmac("sha256", env.SESSION_SECRET).update(`newsletter:${email}:${expiresAt}`).digest("base64url");

/** Token valid until `now + TOKEN_TTL_DAYS`. */
export function newsletterToken(email: string, now: number = Date.now()): string {
  const expiresAt = Math.floor((now + TOKEN_TTL_DAYS * DAY_MS) / 1000);
  return `${expiresAt}.${sign(email, expiresAt)}`;
}

export function confirmationUrl(email: string, now: number = Date.now()): string {
  const url = new URL("/newsletter/confirmar", env.APP_URL);
  url.searchParams.set("email", email);
  url.searchParams.set("token", newsletterToken(email, now));
  return url.toString();
}

/** Whether a confirmation e-mail goes out (Resend, or the dev log); false in production without RESEND_API_KEY. */
export function confirmationDelivered(): boolean {
  return mailAvailable();
}

/** At most one confirmation e-mail per address in this window (in memory, per instance). */
export const RESEND_WINDOW_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

async function deliver(email: string, now: number): Promise<boolean> {
  if (!confirmationDelivered()) return false;
  return delivered(await sendMail(newsletterConfirmationEmail(email, confirmationUrl(email, now))));
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
  return deliver(email, now);
}

export type TokenCheck = { status: "valid"; email: string } | { status: "invalid" } | { status: "expired" };

/** Checks a confirmation link without changing anything (GET of the confirmation page). */
export function checkToken(rawEmail: unknown, token: unknown, now: number = Date.now()): TokenCheck {
  const parsed = newsletterEmailSchema.safeParse(rawEmail);
  if (!parsed.success || typeof token !== "string") return { status: "invalid" };
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return { status: "invalid" };
  const expiresAt = Number(match[1]);
  const expected = Buffer.from(sign(parsed.data, expiresAt));
  const given = Buffer.from(match[2]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { status: "invalid" };
  if (expiresAt * 1000 < now) return { status: "expired" };
  return { status: "valid", email: parsed.data };
}

export type ConfirmResult = "confirmed" | "already" | "invalid" | "expired";

/** Confirms a subscription (POST from the confirmation page). */
export async function confirmSubscription(rawEmail: unknown, token: unknown, now: number = Date.now()): Promise<ConfirmResult> {
  const check = checkToken(rawEmail, token, now);
  if (check.status !== "valid") return check.status;
  const row = await prisma.newsletterSubscriber.findUnique({ where: { email: check.email } });
  if (!row) return "invalid";
  if (row.confirmedAt) return "already";
  await prisma.newsletterSubscriber.update({ where: { email: check.email }, data: { confirmedAt: new Date(now) } });
  return "confirmed";
}

/** Subscription state for the confirmation page (null: no such address). */
export async function subscriberConfirmed(email: string): Promise<boolean | null> {
  const row = await prisma.newsletterSubscriber.findUnique({ where: { email }, select: { confirmedAt: true } });
  return row ? row.confirmedAt !== null : null;
}
