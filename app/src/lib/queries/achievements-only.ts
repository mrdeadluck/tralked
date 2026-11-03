import { prisma } from "@/lib/db";
import { getGame, type GameDetail } from "./games";

export type AchievementsOnlyPlatform = "steam" | "psn" | "xbox" | "retro";

export type AchievementsOnlyItem = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  globalPct: number | null;
  hidden: boolean;
};

export type AchievementsOnly = {
  game: GameDetail;
  lists: { platform: AchievementsOnlyPlatform; achievements: AchievementsOnlyItem[] }[];
};

const ORDER: AchievementsOnlyPlatform[] = ["steam", "psn", "xbox", "retro"];

/**
 * A game's synced achievements, one list per platform the database has, for the guide page of a
 * game without a Tralked guide. Null when the game does not exist or has no achievement at all.
 */
export async function getAchievementsOnly(slug: string): Promise<AchievementsOnly | null> {
  const game = await getGame(slug);
  if (!game) return null;
  const rows = await prisma.achievement.findMany({
    where: { gameId: game.id, platform: { in: ORDER } },
    orderBy: [{ globalPct: { sort: "desc", nulls: "last" } }, { name: "asc" }],
  });
  if (rows.length === 0) return null;

  const lists = ORDER.flatMap((platform) => {
    const achievements = rows
      .filter((r) => r.platform === platform)
      .map((r) => ({
        id: r.id,
        name: r.namePt ?? r.name,
        description: r.descriptionPt ?? r.description,
        iconUrl: r.iconUrl,
        globalPct: r.globalPct,
        hidden: r.hidden,
      }));
    return achievements.length > 0 ? [{ platform, achievements }] : [];
  });
  return { game, lists };
}

/**
 * Hidden achievements lose their text (the name becomes empty) before reaching the page, so the
 * spoiler is neither in the HTML nor in the client payload; the visitor fetches it on "mostrar".
 */
export function maskHidden(lists: AchievementsOnly["lists"]): AchievementsOnly["lists"] {
  return lists.map((l) => ({
    ...l,
    achievements: l.achievements.map((a) =>
      a.hidden ? { ...a, name: "", description: null, iconUrl: null } : a,
    ),
  }));
}
