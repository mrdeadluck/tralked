import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail, type MailStatus } from "@/lib/mail/mailer";
import { emailConfirmationEmail, welcomeEmail } from "@/lib/mail/templates";
import { createLimiter } from "./rate-limit";

/**
 * "Confirme o seu e-mail": never required to use the Tralked, it only gives the account the
 * "e-mail confirmado" badge (User.emailVerifiedAt). The link carries `<userId>.<expiry>.<HMAC>`
 * signed with SESSION_SECRET over the user id, the e-mail and the expiry: no table, it cannot be
 * forged, and it stops working when the account's e-mail changes or after VERIFY_TTL_DAYS.
 * The link opens a page; confirming takes a POST (a button), so mail scanners that prefetch
 * links confirm nothing.
 */

export const VERIFY_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

const sign = (userId: string, email: string, expiresAt: number) =>
  createHmac("sha256", env.SESSION_SECRET).update(`email-verify:${userId}:${email}:${expiresAt}`).digest("base64url");

export function emailVerificationToken(userId: string, email: string, now: number = Date.now()): string {
  const expiresAt = Math.floor((now + VERIFY_TTL_DAYS * DAY_MS) / 1000);
  return `${userId}.${expiresAt}.${sign(userId, email, expiresAt)}`;
}

export function emailVerificationLink(userId: string, email: string, now: number = Date.now()): string {
  const url = new URL("/confirmar-email", env.APP_URL);
  url.searchParams.set("token", emailVerificationToken(userId, email, now));
  return url.toString();
}

export type VerifyCheck =
  | { status: "valid"; userId: string; email: string; displayName: string }
  | { status: "already"; email: string }
  | { status: "invalid" }
  | { status: "expired" };

/** Checks a link without changing anything (GET of the confirmation page). */
export async function checkEmailVerificationToken(token: unknown, now: number = Date.now()): Promise<VerifyCheck> {
  if (typeof token !== "string") return { status: "invalid" };
  const match = /^([A-Za-z0-9_-]{1,64})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return { status: "invalid" };
  const [, userId, rawExpiry, mac] = match;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true, displayName: true },
  });
  if (!user?.email) return { status: "invalid" };
  const expiresAt = Number(rawExpiry);
  const expected = Buffer.from(sign(userId, user.email, expiresAt));
  const given = Buffer.from(mac);
  // A link for an e-mail the account no longer has fails here too.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { status: "invalid" };
  if (user.emailVerifiedAt) return { status: "already", email: user.email };
  if (expiresAt * 1000 < now) return { status: "expired" };
  return { status: "valid", userId, email: user.email, displayName: user.displayName };
}

export type ConfirmEmailResult = "confirmed" | "already" | "invalid" | "expired";

/** Confirms the e-mail (POST from the confirmation page). */
export async function confirmEmail(token: unknown, now: number = Date.now()): Promise<ConfirmEmailResult> {
  const check = await checkEmailVerificationToken(token, now);
  if (check.status !== "valid") return check.status;
  // Guarded by the e-mail: a change between the check and the update confirms nothing.
  const { count } = await prisma.user.updateMany({
    where: { id: check.userId, email: check.email, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date(now) },
  });
  return count === 1 ? "confirmed" : "already";
}

/** "Reenviar e-mail de confirmação" in /conta: per account (in memory, per instance, like the other limiters). */
export const confirmationResendLimiter = createLimiter({ limit: 3, windowMs: 60 * 60_000 });

export type SendConfirmationResult = MailStatus | "no_email" | "already";

/** Sends the confirmation link to the account's current e-mail (unless it is already confirmed). */
export async function sendEmailConfirmation(userId: string, now: number = Date.now()): Promise<SendConfirmationResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true, displayName: true },
  });
  if (!user?.email) return "no_email";
  if (user.emailVerifiedAt) return "already";
  return sendMail(emailConfirmationEmail(user.email, user.displayName, emailVerificationLink(userId, user.email, now)));
}

/**
 * Welcome e-mail of a new account; while the e-mail is unconfirmed it carries the confirmation
 * link too (one e-mail per sign-up). Idempotent per account at Resend.
 */
export async function sendWelcomeEmail(userId: string, now: number = Date.now()): Promise<SendConfirmationResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true, displayName: true },
  });
  if (!user?.email) return "no_email";
  const link = user.emailVerifiedAt ? undefined : emailVerificationLink(userId, user.email, now);
  return sendMail({ ...welcomeEmail(user.email, user.displayName, link), idempotencyKey: `welcome/${userId}` });
}
