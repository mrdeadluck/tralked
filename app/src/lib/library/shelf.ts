import { prisma } from "@/lib/db";
import { achievementTotal } from "@/lib/games/achievement-total";
import { GAME_ART_SELECT, gameArtUrls } from "@/lib/queries/game-art";

/**
 * The "Estante" of the character sheet: the player's most played games (all platforms added up),
 * with the art for the spine and the achievements for the label. Reads only those games, never
 * the whole library. Callers check visibility first.
 */

export type ShelfGame = {
  slug: string;
  name: string;
  /** Portrait cover (the spine and the card); null: the spine falls back to the wide art. */
  coverUrl: string | null;
  heroUrl: string | null;
  /** Playtime over every platform (minutes). */
  playtimeMin: number;
  unlocked: number;
  /** Achievements over the platforms the player has it on (0: none known). */
  total: number;
  /** 100% on some platform. */
  completed: boolean;
};

export async function getShelfGames(userId: string, limit = 20): Promise<ShelfGame[]> {
  const top = await prisma.userGame.groupBy({
    by: ["gameId"],
    where: { userId, playtimeMin: { gt: 0 } },
    _sum: { playtimeMin: true },
    orderBy: { _sum: { playtimeMin: "desc" } },
    take: limit,
  });
  if (top.length === 0) return [];
  const ids = top.map((t) => t.gameId);
  const [rows, totals] = await Promise.all([
    prisma.userGame.findMany({
      where: { userId, gameId: { in: ids } },
      select: {
        gameId: true,
        platform: true,
        unlockedCount: true,
        completedAt: true,
        game: { select: { slug: true, name: true, achievementCount: true, ...GAME_ART_SELECT } },
      },
    }),
    prisma.achievement.groupBy({ by: ["gameId", "platform"], where: { gameId: { in: ids } }, _count: { _all: true } }),
  ]);
  const totalOf = new Map(totals.map((t) => [`${t.gameId}:${t.platform}`, t._count._all]));
  const byGame = new Map<string, ShelfGame>();
  for (const r of rows) {
    let game = byGame.get(r.gameId);
    if (!game) {
      const art = gameArtUrls(r.game);
      game = {
        slug: r.game.slug,
        name: r.game.name,
        coverUrl: art.coverUrl,
        heroUrl: art.heroUrl,
        playtimeMin: 0,
        unlocked: 0,
        total: 0,
        completed: false,
      };
      byGame.set(r.gameId, game);
    }
    game.unlocked += r.unlockedCount;
    game.total += achievementTotal(r.platform, r.game.achievementCount, totalOf.get(`${r.gameId}:${r.platform}`) ?? 0);
    game.completed ||= r.completedAt !== null;
  }
  return top.flatMap((t) => {
    const game = byGame.get(t.gameId);
    return game ? [{ ...game, playtimeMin: t._sum.playtimeMin ?? 0 }] : [];
  });
}
