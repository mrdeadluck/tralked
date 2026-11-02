import { prisma } from "@/lib/db";
import { gameScene } from "@/lib/queries/news";

/** Wide art of one game (hero, else a screenshot, else its cover): the backdrop of a showcase. */
export async function getGameBackdrop(slug: string): Promise<string | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    select: {
      slug: true,
      name: true,
      heroUrl: true,
      coverUrl: true,
      media: { where: { kind: "screenshot", url: { not: null } }, orderBy: { order: "asc" }, take: 1, select: { url: true, kind: true } },
    },
  });
  return game ? gameScene([game], slug) : null;
}
