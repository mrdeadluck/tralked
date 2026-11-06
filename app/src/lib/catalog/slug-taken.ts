import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * The slugs of `slugs` a new game may not take: a game's slug, or an old URL of a joined game
 * (GameSlugRedirect.fromSlug). A game created on a redirect's slug would shadow the redirect: the
 * page would show the new, empty game instead of leading to the game the old one was joined into.
 * Every game creator asks this (IGDB stubs, Steam writers, platform titles, the RA catalog).
 */
export async function takenSlugs(slugs: string[], db: Db = prisma): Promise<Set<string>> {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return new Set();
  const [games, redirects] = await Promise.all([
    db.game.findMany({ where: { slug: { in: unique } }, select: { slug: true } }),
    db.gameSlugRedirect.findMany({ where: { fromSlug: { in: unique } }, select: { fromSlug: true } }),
  ]);
  return new Set([...games.map((g) => g.slug), ...redirects.map((r) => r.fromSlug)]);
}

/**
 * Whether `slug` is taken (see takenSlugs). `exceptGameId`: the game that asks (renaming itself):
 * its own slug, or a redirect that already leads to it, is not taken for it.
 */
export async function slugTaken(slug: string, db: Db = prisma, exceptGameId?: string): Promise<boolean> {
  const [game, redirect] = await Promise.all([
    db.game.findUnique({ where: { slug }, select: { id: true } }),
    db.gameSlugRedirect.findUnique({ where: { fromSlug: slug }, select: { gameId: true } }),
  ]);
  if (game && game.id !== exceptGameId) return true;
  return redirect !== null && redirect.gameId !== exceptGameId;
}
