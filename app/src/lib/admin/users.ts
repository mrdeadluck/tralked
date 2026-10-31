import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ROLES, type Role } from "./roles";

/** Roles (admin only). Nobody changes their own role, so the last admin cannot lock themselves out. */

export { ROLE_LABEL, ROLES, type Role } from "./roles";

export const roleChangeSchema = z.strictObject({
  userId: z.string().min(1).max(64),
  role: z.enum(ROLES, { error: "Papel inválido" }),
});

export async function changeRole(
  actorId: string,
  input: z.output<typeof roleChangeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.userId === actorId) return { ok: false, error: "Você não pode mudar o seu próprio papel." };
  const { count } = await prisma.user.updateMany({ where: { id: input.userId }, data: { role: input.role } });
  return count === 1 ? { ok: true } : { ok: false, error: "Este usuário não existe mais." };
}

export const USERS_PER_PAGE = 40;

export async function listUsers(filter: { q?: string | null; role?: Role | null; page?: number }) {
  const where: Prisma.UserWhereInput = {
    ...(filter.role ? { role: filter.role } : {}),
    ...(filter.q
      ? {
          OR: [
            { handle: { contains: filter.q, mode: "insensitive" } },
            { displayName: { contains: filter.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const total = await prisma.user.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  const page = Math.min(Math.max(1, filter.page ?? 1), pageCount);
  const rows = await prisma.user.findMany({
    where,
    // By role (admin, author, editor, user), then handle.
    orderBy: [{ role: "asc" }, { handle: "asc" }],
    skip: (page - 1) * USERS_PER_PAGE,
    take: USERS_PER_PAGE,
    select: {
      id: true,
      handle: true,
      displayName: true,
      role: true,
      createdAt: true,
      lastSyncedAt: true,
      stats: { select: { level: true } },
    },
  });
  return {
    rows: rows.map((u) => ({ ...u, level: u.stats?.level ?? null })),
    total,
    page,
    pageCount,
  };
}
