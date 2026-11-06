"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { gameTag } from "@/lib/queries/games-cached";
import { loadPsnCatalogTrophies } from "@/lib/sync/psn-catalog-trophies";

export type LoadPsnTrophiesResult = { status: "loaded" } | { status: "none" } | { status: "invalid" } | { status: "not_found" } | { status: "failed" };

const gameIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/**
 * Reads the trophy list of a PSN catalog list of the game the first time its page is opened
 * (lib/sync/psn-catalog-trophies.ts), by anyone, logged in or not. One list per call and one
 * request to Sony; the list is claimed in the database first, so repeated or concurrent calls cost
 * nothing, and a Sony failure only means "try later". With new rows the game's cached page data
 * is expired and the page refreshed, so the visitor sees the version's trophies at once.
 */
export async function loadPsnTrophies(gameId: unknown): Promise<LoadPsnTrophiesResult> {
  const parsed = gameIdSchema.safeParse(gameId);
  if (!parsed.success) return { status: "invalid" };
  const game = await prisma.game.findUnique({ where: { id: parsed.data }, select: { id: true, slug: true } });
  if (!game) return { status: "not_found" };

  const result = await loadPsnCatalogTrophies(game.id);
  if (result !== "loaded") return { status: result };
  updateTag(gameTag(game.slug));
  refresh();
  return { status: "loaded" };
}
