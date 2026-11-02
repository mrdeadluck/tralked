"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { PlatformNotConfiguredError } from "@/lib/integrations/availability";
import { getRetroCatalog } from "@/lib/integrations/retro/catalog";
import { gameTag } from "@/lib/queries/games-cached";
import { syncRetroAchievements } from "@/lib/sync/retro-achievements";

export type LoadRetroResult =
  | { status: "loaded" }
  | { status: "none" }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "disabled" }
  | { status: "failed" };

const gameIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/**
 * Reads the RetroAchievements achievement list of a game the first time its page is opened
 * (lib/sync/retro-achievements.ts), by anyone, logged in or not. Each RA set is claimed in the
 * database before RA is asked, so repeated or concurrent calls cost nothing; a game without a due
 * set is one cheap lookup. With new rows the game's cached page data is expired and the page
 * refreshed, so the visitor sees the counts at once.
 */
export async function loadRetroAchievements(gameId: unknown): Promise<LoadRetroResult> {
  const parsed = gameIdSchema.safeParse(gameId);
  if (!parsed.success) return { status: "invalid" };
  const game = await prisma.game.findUnique({ where: { id: parsed.data }, select: { id: true, slug: true } });
  if (!game) return { status: "not_found" };

  let api;
  try {
    api = getRetroCatalog();
  } catch (error) {
    if (error instanceof PlatformNotConfiguredError) return { status: "disabled" };
    throw error;
  }
  const result = await syncRetroAchievements(game.id, api);
  if (result.sets === 0) return { status: result.failed > 0 ? "failed" : "none" };
  updateTag(gameTag(game.slug));
  if (result.written === 0) return { status: "none" };
  refresh();
  return { status: "loaded" };
}
