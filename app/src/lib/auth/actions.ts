"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { authenticate, createAccount, emailSchema, normalizeEmail, passwordSchema, signupSchema } from "./credentials";
import type { AuthFormState } from "./form-state";
import { mailAvailable } from "@/lib/mail/mailer";
import { MAIL_OFF_MESSAGE } from "@/lib/mail/messages";
import { sendWelcomeEmail } from "./email-verification";
import { PASSWORD_MAX } from "./limits";
import { requestPasswordReset, resetPassword } from "./password-reset";
import {
  loginEmailLimiter,
  loginIpLimiter,
  resetEmailLimiter,
  resetIpLimiter,
  signupIpLimiter,
  type LimitResult,
} from "./rate-limit";
import { DEFAULT_RETURN_TO, sanitizeReturnTo } from "./return-to";
import { createSession } from "./session";

/**
 * Sign-up, login and password reset (useActionState forms on /cadastrar, /entrar,
 * /esqueci-senha and /redefinir-senha). Every input is validated with zod. Login and "forgot
 * password" answer the same whether or not the e-mail has an account.
 */

const WRONG_CREDENTIALS = "E-mail ou senha incorretos.";
// A "use server" module only exports async functions.
const SIGNUP_LANDING = "/conta/conexoes?bemvindo=1";

/**
 * Where to go after logging in. `/jogador/me` is a redirecting route handler, which a Server
 * Action redirect (a client navigation) does not follow well: go straight to the sheet.
 */
const landing = (returnTo: string, handle: string) =>
  returnTo === DEFAULT_RETURN_TO ? `/jogador/${encodeURIComponent(handle)}` : returnTo;

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
};

/** First message of each field. */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] ??= issue.message;
  }
  return errors;
}

/** The visitor's address as the proxy reports it (only used to count attempts). */
async function clientIp(): Promise<string> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip")?.trim() || "unknown";
}

const tooMany = (limit: Extract<LimitResult, { ok: false }>) =>
  `Muitas tentativas. Tente de novo em ${Math.max(1, Math.ceil(limit.retryAfterSec / 60))} minuto(s).`;

const loginSchema = z.object({
  email: z.string({ error: "Informe o e-mail." }).trim().min(1, { error: "Informe o e-mail." }).max(254),
  password: z.string({ error: "Informe a senha." }).min(1, { error: "Informe a senha." }).max(PASSWORD_MAX),
});

export async function loginAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const values = { email: text(formData, "email")?.trim() ?? "" };
  const parsed = loginSchema.safeParse({ email: text(formData, "email"), password: text(formData, "password") });
  if (!parsed.success) {
    // An over-long password can never be right: same answer as a wrong one.
    const errors = fieldErrors(parsed.error);
    if (!errors.email && errors.password && text(formData, "password")) return { message: WRONG_CREDENTIALS, values };
    return { errors, values };
  }

  const byIp = loginIpLimiter.hit(`ip:${await clientIp()}`);
  if (!byIp.ok) return { message: tooMany(byIp), values };
  const emailKey = normalizeEmail(parsed.data.email);
  const byEmail = loginEmailLimiter.check(emailKey);
  if (!byEmail.ok) return { message: tooMany(byEmail), values };

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    loginEmailLimiter.hit(emailKey);
    return { message: WRONG_CREDENTIALS, values };
  }
  loginEmailLimiter.reset(emailKey);
  await createSession(user.id);
  redirect(landing(sanitizeReturnTo(text(formData, "returnTo")), user.handle));
}

export async function signupAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const values = {
    displayName: text(formData, "displayName")?.trim() ?? "",
    handle: text(formData, "handle")?.trim() ?? "",
    email: text(formData, "email")?.trim() ?? "",
  };
  const parsed = signupSchema.safeParse({
    displayName: text(formData, "displayName"),
    handle: text(formData, "handle"),
    email: text(formData, "email"),
    password: text(formData, "password"),
    terms: text(formData, "terms"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };

  const byIp = signupIpLimiter.hit(`ip:${await clientIp()}`);
  if (!byIp.ok) return { message: tooMany(byIp), values };

  const created = await createAccount(parsed.data);
  if (!created.ok) {
    return {
      errors:
        created.field === "email"
          ? { email: "Esse e-mail já tem uma conta no Tralked. Entre com ele ou redefina a senha." }
          : { handle: "Esse @ já está em uso. Escolha outro." },
      values,
    };
  }
  await createSession(created.user.id);
  // Welcome + "confirme o seu e-mail", after the response (never blocks or fails the sign-up).
  const userId = created.user.id;
  after(async () => {
    try {
      await sendWelcomeEmail(userId);
    } catch (error) {
      console.error("Welcome e-mail failed", error instanceof Error ? error.message : String(error));
    }
  });
  redirect(SIGNUP_LANDING);
}

export async function forgotPasswordAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const values = { email: text(formData, "email")?.trim() ?? "" };
  const parsed = z.object({ email: emailSchema }).safeParse({ email: text(formData, "email") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  // Production without RESEND_API_KEY: say so instead of promising an e-mail that never comes.
  if (!mailAvailable()) return { message: MAIL_OFF_MESSAGE, values };

  const byIp = resetIpLimiter.hit(`ip:${await clientIp()}`);
  if (!byIp.ok) return { message: tooMany(byIp), values };
  // Counted per address whether or not it has an account, so the limit reveals nothing either.
  const byEmail = resetEmailLimiter.hit(parsed.data.email);
  if (byEmail.ok) {
    // After the response: answering takes the same time whether or not the e-mail exists.
    const email = parsed.data.email;
    after(async () => {
      try {
        await requestPasswordReset(email);
      } catch (error) {
        console.error("Password reset request failed", error instanceof Error ? error.message : String(error));
      }
    });
  }
  return {
    done: true,
    message:
      "Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha. O link vale 1 hora.",
    values,
  };
}

const resetSchema = z
  .object({
    token: z.string().min(1).max(200),
    password: passwordSchema,
    confirm: z.string({ error: "Repita a nova senha." }).max(PASSWORD_MAX),
  })
  .refine((data) => data.password === data.confirm, { path: ["confirm"], error: "As senhas não são iguais." });

export async function resetPasswordAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = resetSchema.safeParse({
    token: text(formData, "token"),
    password: text(formData, "password"),
    confirm: text(formData, "confirm"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const result = await resetPassword(parsed.data.token, parsed.data.password);
  if (!result.ok) return { message: "Este link expirou ou já foi usado. Peça um novo em “Esqueci a senha”." };
  await createSession(result.userId);
  redirect(landing(DEFAULT_RETURN_TO, result.handle));
}
