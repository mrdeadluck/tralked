import { prisma } from "@/lib/db";
import { emailSchema } from "./credentials";
import { createPasswordResetToken, passwordResetLink } from "./password-reset";

export type InviteResult =
  | { ok: true; handle: string; email: string; link: string }
  | { ok: false; reason: "invalid_email" | "not_found" | "email_taken" };

/**
 * `pnpm user:invite <handle> <email>`: gives an existing account (e.g. an admin created by the
 * old Steam login, without e-mail or password) a login e-mail and a "set your password" link,
 * the same single-use, 1-hour link as "Esqueci a senha". The handle is matched ignoring case.
 */
export async function inviteUser(handle: string, email: string, now: Date = new Date()): Promise<InviteResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, reason: "invalid_email" };
  const user = await prisma.user.findFirst({
    where: { handle: { equals: handle.replace(/^@/, "").trim(), mode: "insensitive" } },
    select: { id: true, handle: true },
  });
  if (!user) return { ok: false, reason: "not_found" };
  const owner = await prisma.user.findFirst({
    where: { email: { equals: parsed.data, mode: "insensitive" }, id: { not: user.id } },
    select: { id: true },
  });
  if (owner) return { ok: false, reason: "email_taken" };

  await prisma.user.update({ where: { id: user.id }, data: { email: parsed.data } });
  const token = await createPasswordResetToken(user.id, now);
  return { ok: true, handle: user.handle, email: parsed.data, link: passwordResetLink(token) };
}
