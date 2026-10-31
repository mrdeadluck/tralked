"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { markAllRead, markRead } from "./inbox";

export type NotificationActionResult = { ok: true } | { ok: false; error: string };

const NOT_LOGGED_IN: NotificationActionResult = { ok: false, error: "Entre na sua conta para continuar." };

/** Marks every notification of the logged-in user as read. */
export async function markAllReadAction(): Promise<NotificationActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  await markAllRead(user.id);
  return { ok: true };
}

const idSchema = z.string().min(1).max(64);

/** Marks one of the logged-in user's notifications as read (someone else's id is "not found"). */
export async function markReadAction(id: unknown): Promise<NotificationActionResult> {
  const user = await getSessionUser();
  if (!user) return NOT_LOGGED_IN;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Notificação inválida." };
  if (!(await markRead(user.id, parsed.data))) return { ok: false, error: "Essa notificação não existe mais." };
  return { ok: true };
}
