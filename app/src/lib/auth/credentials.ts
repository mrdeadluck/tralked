import { z } from "zod";
import { Prisma, type User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { DISPLAY_NAME_MAX, EMAIL_MAX, HANDLE_MAX, HANDLE_MIN, PASSWORD_MAX, PASSWORD_MIN } from "./limits";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { RESERVED_HANDLES } from "./upsert-user";

/**
 * Tralked's own accounts: e-mail + password. E-mails are stored trimmed and lowercased; the
 * password only as a scrypt hash (./password.ts). Login answers the same for an unknown e-mail,
 * a wrong password and an account without a password, and takes the same time for all three.
 */

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const emailSchema = z
  .string({ error: "Informe o e-mail." })
  .trim()
  .toLowerCase()
  .min(1, { error: "Informe o e-mail." })
  .max(EMAIL_MAX, { error: "Informe um e-mail válido." })
  .pipe(z.email({ error: "Informe um e-mail válido." }));

export const passwordSchema = z
  .string({ error: "Informe a senha." })
  .min(PASSWORD_MIN, { error: `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.` })
  .max(PASSWORD_MAX, { error: `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.` });

export const handleSchema = z
  .string({ error: "Escolha um @." })
  .trim()
  .regex(new RegExp(`^[A-Za-z0-9_]{${HANDLE_MIN},${HANDLE_MAX}}$`), {
    error: `Use de ${HANDLE_MIN} a ${HANDLE_MAX} letras sem acento, números ou _.`,
  })
  .refine((handle) => !RESERVED_HANDLES.has(handle.toLowerCase()), { error: "Esse @ é reservado. Escolha outro." });

export const displayNameSchema = z
  .string({ error: "Informe como quer aparecer." })
  .trim()
  .min(1, { error: "Informe como quer aparecer." })
  .max(DISPLAY_NAME_MAX, { error: `Use no máximo ${DISPLAY_NAME_MAX} caracteres.` });

export const signupSchema = z.object({
  displayName: displayNameSchema,
  handle: handleSchema,
  email: emailSchema,
  password: passwordSchema,
  // An HTML checkbox sends "on" when checked and nothing otherwise.
  terms: z
    .literal("on", { error: "Para criar a conta, aceite os Termos de uso e a Política de privacidade." })
    .transform(() => true as const),
});

export type SignupData = z.infer<typeof signupSchema>;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const insensitive = (value: string) => ({ equals: value, mode: "insensitive" as const });

async function emailTaken(email: string, exceptUserId?: string): Promise<boolean> {
  const owner = await prisma.user.findFirst({
    where: { email: insensitive(email), ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    select: { id: true },
  });
  return owner !== null;
}

const handleTaken = async (handle: string) =>
  (await prisma.user.findFirst({ where: { handle: insensitive(handle) }, select: { id: true } })) !== null;

export type CreateAccountResult = { ok: true; user: User } | { ok: false; field: "email" | "handle" };

/** Creates a reader account (role `user`, no platform connected yet). */
export async function createAccount(data: SignupData): Promise<CreateAccountResult> {
  if (await emailTaken(data.email)) return { ok: false, field: "email" };
  if (await handleTaken(data.handle)) return { ok: false, field: "handle" };
  try {
    const user = await prisma.user.create({
      data: {
        handle: data.handle,
        displayName: data.displayName,
        email: normalizeEmail(data.email),
        passwordHash: await hashPassword(data.password),
      },
    });
    return { ok: true, user };
  } catch (error) {
    // The same e-mail or @ was taken a moment earlier.
    if (!isUniqueViolation(error)) throw error;
    const target = String((error as Prisma.PrismaClientKnownRequestError).meta?.target ?? "");
    return { ok: false, field: target.includes("email") ? "email" : "handle" };
  }
}

/** The account for these credentials, or null (unknown e-mail, wrong password, no password set). */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user?.passwordHash) return verifyAgainstDummy(password).then(() => null);
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

/** `changed`: the e-mail is a new one (it starts unconfirmed). */
export type CredentialChangeResult =
  | { ok: true; changed?: boolean }
  | { ok: false; reason: "wrong_password" | "email_taken" };

/** The current password is required when the account has one. */
async function currentPasswordMatches(user: Pick<User, "passwordHash">, current: string | undefined) {
  return !user.passwordHash || (await verifyPassword(current ?? "", user.passwordHash));
}

/** Sets a new password (the current one is required when there is one). */
export async function changePassword(
  userId: string,
  current: string | undefined,
  next: string,
): Promise<CredentialChangeResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await currentPasswordMatches(user, current))) return { ok: false, reason: "wrong_password" };
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  return { ok: true };
}

/** Sets the login e-mail (the current password is required when there is one). */
export async function changeEmail(
  userId: string,
  email: string,
  currentPassword: string | undefined,
): Promise<CredentialChangeResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await currentPasswordMatches(user, currentPassword))) return { ok: false, reason: "wrong_password" };
  const normalized = normalizeEmail(email);
  if (user.email === normalized) return { ok: true, changed: false };
  if (await emailTaken(normalized, userId)) return { ok: false, reason: "email_taken" };
  try {
    // A new e-mail is not confirmed yet ("e-mail confirmado" belongs to the old one).
    await prisma.user.update({ where: { id: userId }, data: { email: normalized, emailVerifiedAt: null } });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "email_taken" };
    throw error;
  }
  return { ok: true, changed: true };
}
