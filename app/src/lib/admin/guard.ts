import { notFound } from "next/navigation";
import { cache } from "react";
import type { z } from "zod";
import type { User } from "@/generated/prisma/client";
import { getSessionUser } from "@/lib/auth/session";

import { canAccess, type AccessLevel } from "./access";

/**
 * Access to /admin. Editors manage content and moderation; only admins manage API keys, feeds,
 * roles, fraud and game overrides. The proxy answers 404 before rendering (real status code);
 * every page and every Server Action checks the role again on the server: hiding a link is
 * never the protection.
 */

export { canAccess, type AccessLevel };

/** The session user, read once per request (the layout and the page both check it). */
const pageUser = cache(getSessionUser);

/**
 * The logged-in staff member for an admin page. Anyone else (visitor, user, author, or an editor
 * on an admin-only page) gets a real 404: the admin's existence is not advertised.
 */
export async function requireStaffPage(level: AccessLevel = "staff"): Promise<User> {
  const user = await pageUser();
  if (!user || !canAccess(user.role, level)) notFound();
  return user;
}

/** Result of every admin Server Action; `error` is pt-BR and ready to show. */
export type AdminResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string };

export const FORBIDDEN_MESSAGE = "Você não tem permissão para fazer isso.";

export function invalidInput(error: z.ZodError): { ok: false; error: string; field?: string } {
  const issue = error.issues[0];
  const field = issue?.path.length ? issue.path.join(".") : undefined;
  return { ok: false, error: issue?.message ?? "Dados inválidos.", field };
}

/**
 * Session + role check, then zod validation, before an admin action touches anything.
 * The role is read from the database on every call, so a demotion takes effect at once.
 */
export async function authorizeAction<S extends z.ZodType>(
  level: AccessLevel,
  schema: S,
  raw: unknown,
): Promise<{ ok: true; user: User; data: z.output<S> } | { ok: false; error: string; field?: string }> {
  const user = await getSessionUser();
  if (!user || !canAccess(user.role, level)) return { ok: false, error: FORBIDDEN_MESSAGE };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return invalidInput(parsed.error);
  return { ok: true, user, data: parsed.data };
}
