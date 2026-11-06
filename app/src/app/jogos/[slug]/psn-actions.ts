"use server";

import { refresh, updateTag } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { psnOpenIpLimiter } from "@/lib/auth/rate-limit";
import { prisma } from "@/lib/db";
import { gameTag } from "@/lib/queries/games-cached";
import { isAutomatedClient } from "@/lib/seo/ai-crawlers";
import { loadPsnCatalogTrophies } from "@/lib/sync/psn-catalog-trophies";

export type LoadPsnTrophiesResult = { status: "loaded" } | { status: "none" } | { status: "invalid" } | { status: "not_found" } | { status: "failed" } | { status: "limited" } | { status: "skipped" };

/** The visitor's address as the proxy reports it (same as lib/auth/actions.ts; only used to count opens). */
async function clientIp(): Promise<string> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip")?.trim() || "unknown";
}

const gameIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/**
 * Reads the trophy list of a PSN catalog list of the game the first time its page is opened
 * (lib/sync/psn-catalog-trophies.ts), by anyone, logged in or not. One list per call and one
 * request to Sony; the list is claimed in the database first, so repeated or concurrent calls cost
 * nothing, and a Sony failure only means "try later". With new rows the game's cached page data
 * is expired and the page refreshed, so the visitor sees the version's trophies at once.
 * The action is a public POST, so it is bounded: robots and scripts are skipped (no work for
 * them), each IP gets psnOpenIpLimiter, only a game with a list that is due does anything, and
 * loadPsnCatalogTrophies keeps the site-wide budget, the backoff of failing lists and the cooldown.
 */
export async function loadPsnTrophies(gameId: unknown): Promise<LoadPsnTrophiesResult> {
  const parsed = gameIdSchema.safeParse(gameId);
  if (!parsed.success) return { status: "invalid" };
  if (isAutomatedClient((await headers()).get("user-agent"))) return { status: "skipped" };
  if (!psnOpenIpLimiter.hit(await clientIp()).ok) return { status: "limited" };
  const game = await prisma.game.findUnique({ where: { id: parsed.data }, select: { id: true, slug: true } });
  if (!game) return { status: "not_found" };

  const result = await loadPsnCatalogTrophies(game.id);
  if (result !== "loaded") return { status: result };
  updateTag(gameTag(game.slug));
  refresh();
  return { status: "loaded" };
}
