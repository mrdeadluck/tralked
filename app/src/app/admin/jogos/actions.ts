"use server";

import { revalidateTag, updateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { gameOverrideSchema, updateGameOverrides } from "@/lib/admin/catalog";
import { authorizeAction, type AdminResult } from "@/lib/admin/guard";
import { prisma } from "@/lib/db";
import { recomputeUser } from "@/lib/progression/recompute";
import { gameTag } from "@/lib/queries/games-cached";
import { syncGameMedia } from "@/lib/sync/media";

/** Skills (genres) and aliases of a game (admin only). Owners are recomputed in the background. */
export async function saveGameOverridesAction(raw: unknown): Promise<AdminResult<{ recomputing: number }>> {
  const ready = await authorizeAction("admin", gameOverrideSchema, raw);
  if (!ready.ok) return ready;
  const result = await updateGameOverrides(ready.data);
  if (!result.ok) return result;
  updateTag(gameTag(result.slug));
  if (result.owners.length > 0) {
    after(async () => {
      for (const userId of result.owners) {
        try {
          await recomputeUser(userId);
        } catch (error) {
          console.error("Admin: recompute after a skill override failed", userId, error instanceof Error ? error.message : error);
        }
      }
    });
  }
  return { ok: true, recomputing: result.owners.length };
}

const gameIdSchema = z.strictObject({ gameId: z.string().min(1).max(64) });

/** Refreshes the game's official media (IGDB/SteamGridDB) after the response (admin only). */
export async function syncGameMediaAction(raw: unknown): Promise<AdminResult> {
  const ready = await authorizeAction("admin", gameIdSchema, raw);
  if (!ready.ok) return ready;
  const game = await prisma.game.findUnique({ where: { id: ready.data.gameId }, select: { id: true, slug: true } });
  if (!game) return { ok: false, error: "Este jogo não existe mais." };
  after(async () => {
    try {
      const written = await syncGameMedia(game.id);
      if (written) revalidateTag(gameTag(game.slug), "max");
    } catch (error) {
      console.error("Admin: media sync failed", game.slug, error instanceof Error ? error.message : error);
    }
  });
  return { ok: true };
}
