import { z } from "zod";
import { prisma } from "@/lib/db";
import { logModeration } from "./log";
import { moderationReasonSchema, notifyOwner } from "./notice";
import { canSanction, formatUntil } from "./permissions";

/**
 * Mutes and bans with an end date (User.mutedUntil / User.bannedUntil).
 * - Mute: no comments, forum posts or photo uploads until the date (lib/moderation/permissions).
 * - Ban: the session is refused (lib/auth/session.getSessionUser), so the user cannot log in or
 *   interact; every write path also checks it.
 * Both end on their own at the date; a moderator may lift them earlier.
 */

export const SANCTION_KINDS = ["mute", "ban"] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];

export const SANCTION_LABEL: Record<SanctionKind, string> = { mute: "Silenciar", ban: "Banir" };

/** Longest sanction (days ahead of now). */
export const MAX_SANCTION_DAYS = 3650;

/** The end of `date` (YYYY-MM-DD) in Brasília (UTC-3, no daylight saving time since 2019). */
export const endOfDayBrasilia = (date: string) => new Date(`${date}T23:59:59.999-03:00`);

export const sanctionSchema = z.strictObject({
  handle: z
    .string()
    .trim()
    .transform((h) => h.replace(/^@/, ""))
    .pipe(z.string().min(1, "Informe o @ do usuário.").max(40)),
  kind: z.enum(SANCTION_KINDS, { error: "Escolha silenciar ou banir." }),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data final."),
  reason: moderationReasonSchema,
});

export const liftSanctionSchema = z.strictObject({
  userId: z.string().min(1).max(64),
  kind: z.enum(SANCTION_KINDS),
});

type Actor = { id: string; role: string };
type Result = { ok: true } | { ok: false; error: string; field?: string };

const FIELD = { mute: "mutedUntil", ban: "bannedUntil" } as const;

export async function applySanction(actor: Actor, input: z.output<typeof sanctionSchema>, now: Date = new Date()): Promise<Result> {
  const until = endOfDayBrasilia(input.until);
  if (Number.isNaN(until.getTime())) return { ok: false, error: "Data inválida.", field: "until" };
  if (until.getTime() <= now.getTime()) return { ok: false, error: "A data final precisa ser no futuro.", field: "until" };
  if (until.getTime() - now.getTime() > MAX_SANCTION_DAYS * 86_400_000) {
    return { ok: false, error: "A data final pode ser no máximo daqui a 10 anos.", field: "until" };
  }

  const target = await prisma.user.findFirst({
    where: { handle: { equals: input.handle, mode: "insensitive" } },
    select: { id: true, role: true, handle: true },
  });
  if (!target) return { ok: false, error: `Nenhum usuário com o @${input.handle}.`, field: "handle" };
  if (!canSanction(actor, target)) {
    return { ok: false, error: actor.id === target.id ? "Você não pode punir a si mesmo." : "Você não pode punir este usuário." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { [FIELD[input.kind]]: until } });
    await logModeration(tx, {
      actorId: actor.id,
      action: `user.${input.kind}`,
      targetType: "user",
      targetId: target.id,
      targetUserId: target.id,
      reason: input.reason,
      details: { until: until.toISOString() },
    });
    await notifyOwner(tx, {
      userId: target.id,
      actorId: actor.id,
      title:
        input.kind === "mute"
          ? `Você foi silenciado até ${formatUntil(until)}: não pode comentar nem publicar`
          : `Sua conta foi suspensa até ${formatUntil(until)}`,
      reason: input.reason,
      href: "/termos",
    });
  });
  return { ok: true };
}

/** Ends a mute or ban before its date. */
export async function liftSanction(actor: Actor, input: z.output<typeof liftSanctionSchema>, now: Date = new Date()): Promise<Result> {
  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true, mutedUntil: true, bannedUntil: true },
  });
  if (!target) return { ok: false, error: "Este usuário não existe mais." };
  if (!canSanction(actor, target)) return { ok: false, error: "Você não pode mudar a punição deste usuário." };
  const current = input.kind === "mute" ? target.mutedUntil : target.bannedUntil;
  if (!current || current.getTime() <= now.getTime()) {
    return { ok: false, error: input.kind === "mute" ? "Este usuário não está silenciado." : "Este usuário não está banido." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { [FIELD[input.kind]]: null } });
    await logModeration(tx, {
      actorId: actor.id,
      action: input.kind === "mute" ? "user.unmute" : "user.unban",
      targetType: "user",
      targetId: target.id,
      targetUserId: target.id,
    });
  });
  return { ok: true };
}

export type SanctionRow = {
  id: string;
  handle: string;
  displayName: string;
  mutedUntil: Date | null;
  bannedUntil: Date | null;
};

/** Users with a mute or ban still running (soonest end first). */
export async function listActiveSanctions(now: Date = new Date()): Promise<SanctionRow[]> {
  const rows = await prisma.user.findMany({
    where: { OR: [{ mutedUntil: { gt: now } }, { bannedUntil: { gt: now } }] },
    select: { id: true, handle: true, displayName: true, mutedUntil: true, bannedUntil: true },
    orderBy: { handle: "asc" },
    take: 200,
  });
  return rows.map((r) => ({
    ...r,
    mutedUntil: r.mutedUntil && r.mutedUntil > now ? r.mutedUntil : null,
    bannedUntil: r.bannedUntil && r.bannedUntil > now ? r.bannedUntil : null,
  }));
}
