"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export type MarkOpenedResult =
  | { status: "ok" }
  | { status: "unauthenticated" }
  | { status: "invalid" }
  | { status: "not_found" };

const gameIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/**
 * Records that the logged-in user opened this game's case (the intro then never plays again, on
 * any device). Idempotent: the first `openedAt` is kept. The opened state lives only in the
 * per-user island, so no public cache needs revalidating.
 */
export async function markOpened(gameId: unknown): Promise<MarkOpenedResult> {
  const user = await getSessionUser();
  if (!user) return { status: "unauthenticated" };

  const parsed = gameIdSchema.safeParse(gameId);
  if (!parsed.success) return { status: "invalid" };

  const game = await prisma.game.findUnique({ where: { id: parsed.data }, select: { id: true } });
  if (!game) return { status: "not_found" };

  await prisma.gameOpen.createMany({ data: [{ userId: user.id, gameId: game.id }], skipDuplicates: true });
  return { status: "ok" };
}
