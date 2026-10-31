import { cacheLife } from "next/cache";
import { prisma } from "@/lib/db";
import type { SearchSuggestion } from "@/components/layout/SearchBox";

/**
 * "EM ALTA" in the header search: the most-played games by number of players (Steam libraries
 * where the game was actually played: playtime or an unlock; owned-but-never-played rows and
 * name-only catalog stubs do not count).
 */
export async function getTrendingSuggestions(
  limit = 4,
): Promise<SearchSuggestion[]> {
  "use cache";
  cacheLife("hours");

  const popular = await prisma.userGame.groupBy({
    by: ["gameId"],
    where: {
      platform: "steam",
      OR: [{ playtimeMin: { gt: 0 } }, { unlockedCount: { gt: 0 } }],
      game: { stub: false },
    },
    _count: { gameId: true },
    orderBy: [{ _count: { gameId: "desc" } }, { gameId: "asc" }],
    take: limit,
  });
  const games = await prisma.game.findMany({
    where: { id: { in: popular.map((p) => p.gameId) }, stub: false },
    select: { id: true, slug: true, name: true },
  });
  const byId = new Map(games.map((g) => [g.id, g]));
  return popular.flatMap((p) => {
    const game = byId.get(p.gameId);
    return game ? [{ text: game.name, href: `/jogos/${game.slug}` }] : [];
  });
}
