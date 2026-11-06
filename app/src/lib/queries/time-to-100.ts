import { prisma } from "@/lib/db";

/**
 * Hours to 100%, from one source only: the median of the Tralked players who completed the game
 * (each player's fastest platform), else IGDB's "100%" time to beat. Never an editor's guess. The
 * game page and its guide both read it, so they always show the same number and its source.
 */
export type TimeTo100 = { minutes: number; source: "tralked"; players: number } | { minutes: number; source: "igdb"; players: 0 };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function timeTo100From(playerMinutes: number[], igdbCompleteMin: number | null): TimeTo100 | null {
  if (playerMinutes.length > 0) return { minutes: median(playerMinutes), source: "tralked", players: playerMinutes.length };
  return igdbCompleteMin ? { minutes: igdbCompleteMin, source: "igdb", players: 0 } : null;
}

/** The game's time to 100% (see `timeTo100From`). */
export async function loadTimeTo100(gameId: string, igdbCompleteMin: number | null): Promise<TimeTo100 | null> {
  const completions = await prisma.userGame.findMany({
    where: { gameId, completedAt: { not: null }, playtimeMin: { gt: 0 } },
    select: { userId: true, playtimeMin: true },
  });
  // A completion with an undated unlock is an old one, from an era whose playtime was not recorded
  // reliably: its hours do not say how long the 100% takes.
  const undated = new Set(
    (
      await prisma.userAchievement.findMany({
        where: { unlockedAt: null, achievement: { gameId }, userId: { in: completions.map((c) => c.userId) } },
        select: { userId: true },
        distinct: ["userId"],
      })
    ).map((u) => u.userId),
  );
  const bestByUser = new Map<string, number>();
  for (const c of completions.filter((c) => !undated.has(c.userId))) bestByUser.set(c.userId, Math.min(bestByUser.get(c.userId) ?? Infinity, c.playtimeMin));
  return timeTo100From([...bestByUser.values()], igdbCompleteMin);
}

/** "50 h" and where it comes from ("mediana de 3 jogadores do Tralked" / "estimativa IGDB"). */
export function timeTo100Label(t: TimeTo100): { value: string; source: string } {
  const hours = Math.max(1, Math.round(t.minutes / 60)).toLocaleString("pt-BR");
  return {
    value: `${hours} h`,
    source:
      t.source === "igdb"
        ? "estimativa IGDB"
        : t.players === 1
          ? "1 jogador do Tralked"
          : `mediana de ${t.players.toLocaleString("pt-BR")} jogadores do Tralked`,
  };
}
