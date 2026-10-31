import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { mailAvailable, sendMail } from "@/lib/mail/mailer";
import { passwordResetEmail } from "@/lib/mail/templates";
import { normalizeEmail } from "./credentials";
import { hashPassword } from "./password";

/**
 * "Set a new password" links: forgot password (/esqueci-senha) and `pnpm user:invite`. The token
 * is 32 random bytes (base64url); the database keeps only its SHA-256, so a leaked table cannot be
 * used to reset anyone's password. A link is single-use, lasts RESET_TTL_MS, and using one voids
 * the account's other links.
 */

export const RESET_TTL_MS = 60 * 60_000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new link for the user; returns the raw token (never stored). */
export async function createPasswordResetToken(userId: string, now: Date = new Date()): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MS) },
  });
  return token;
}

export function passwordResetLink(token: string): string {
  const url = new URL("/redefinir-senha", env.APP_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Forgot password: creates and e-mails a link when the e-mail has an account (lib/mail: Resend
 * with RESEND_API_KEY, the server log outside production without it). The caller answers the
 * same either way, so the form never reveals whether an e-mail is registered. In production
 * without a key no link is created (the form says e-mail is off; `pnpm user:invite` still works).
 */
export async function requestPasswordReset(email: string, now: Date = new Date()): Promise<void> {
  if (!mailAvailable()) return;
  const normalized = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!user) return;
  const token = await createPasswordResetToken(user.id, now);
  await sendMail(passwordResetEmail(normalized, passwordResetLink(token)));
}

const usable = (token: string, now: Date) => ({ tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: now } });

export async function isResetTokenValid(token: string, now: Date = new Date()): Promise<boolean> {
  if (!token) return false;
  return (await prisma.passwordResetToken.count({ where: usable(token, now) })) > 0;
}

/** Uses the link: sets the password and voids every other link of the account. */
export async function resetPassword(
  token: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<{ ok: true; userId: string; handle: string } | { ok: false }> {
  if (!token) return { ok: false };
  const row = await prisma.passwordResetToken.findFirst({ where: usable(token, now), select: { id: true, userId: true } });
  if (!row) return { ok: false };
  const passwordHash = await hashPassword(newPassword);
  return prisma.$transaction(async (tx) => {
    // Claimed atomically: two submissions of the same link cannot both set a password.
    const { count } = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (count === 0) return { ok: false as const };
    await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
    const user = await tx.user.update({ where: { id: row.userId }, data: { passwordHash }, select: { handle: true } });
    return { ok: true as const, userId: row.userId, handle: user.handle };
  });
}
